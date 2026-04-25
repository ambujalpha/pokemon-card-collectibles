import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

// ─── pokemontcg.io response shapes ──────────────────────────────────────────

interface TcgPriceBand {
  low?: number | null;
  mid?: number | null;
  market?: number | null;
}

interface TcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  images: { small: string; large: string };
  tcgplayer?: { prices?: Record<string, TcgPriceBand | null> };
}

const FALLBACK_PRICE = 0.25;

// Same picker shape as scripts/fetch-cards.ts — kept duplicated for now rather
// than extracting prematurely; the shapes and fallback order are aligned so a
// refresh produces the same prices the seed would.
function pickBasePrice(card: TcgCard): number {
  const priceSets = card.tcgplayer?.prices;
  if (!priceSets) return FALLBACK_PRICE;
  const preferred = [
    "holofoil",
    "normal",
    "reverseHolofoil",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
  ];
  for (const key of preferred) {
    const p = priceSets[key];
    if (p?.market != null) return p.market;
    if (p?.mid != null) return p.mid;
  }
  for (const p of Object.values(priceSets)) {
    if (p?.market != null) return p.market;
    if (p?.mid != null) return p.mid;
  }
  return FALLBACK_PRICE;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface PriceChange {
  cardId: string;
  from: string;
  to: string;
}

export interface RefreshResult {
  refreshedAt: string;
  totalCards: number;
  changedCount: number;
  staleCount: number;
  changes: PriceChange[];
  upstreamOk: boolean;
}

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

// Fetch pricing for a set from pokemontcg.io. Returns a Map keyed by
// pokemontcgId → fresh price. Honours POKEMONTCG_API_KEY when present.
export async function fetchSetPrices(setCode: string): Promise<Map<string, number>> {
  const url = `https://api.pokemontcg.io/v2/cards?q=set.id:${setCode}&pageSize=250`;
  const headers: Record<string, string> = {};
  const apiKey = process.env.POKEMONTCG_API_KEY;
  if (apiKey) headers["X-Api-Key"] = apiKey;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new UpstreamError(`pokemontcg.io returned ${res.status}`);
  }
  const body = (await res.json()) as { data: TcgCard[] };
  const out = new Map<string, number>();
  for (const card of body.data) {
    out.set(card.id, pickBasePrice(card));
  }
  return out;
}

// Pure diff function — given old and new price maps, return the list of
// cardId-level changes (only where the decimal value differs). Used by
// refreshAllCards and directly unit-testable.
export function buildChanges(
  cards: ReadonlyArray<{ id: string; pokemontcgId: string; basePrice: Prisma.Decimal | string }>,
  newPrices: ReadonlyMap<string, number>,
  jitter = 0,
): { changes: PriceChange[]; perCard: Map<string, { newPrice: string; hadFetched: boolean }> } {
  const changes: PriceChange[] = [];
  const perCard = new Map<string, { newPrice: string; hadFetched: boolean }>();
  for (const c of cards) {
    const fetched = newPrices.get(c.pokemontcgId);
    const hadFetched = fetched !== undefined;
    if (!hadFetched) {
      // Upstream didn't return this card — keep old price, mark stale.
      perCard.set(c.id, { newPrice: new Prisma.Decimal(c.basePrice).toFixed(4), hadFetched: false });
      continue;
    }
    // Apply optional demo-seam jitter AFTER real fetch. Clamp to 0.01 min.
    let candidate = fetched!;
    if (jitter > 0) {
      const delta = (Math.random() * 2 - 1) * jitter;
      candidate = Math.max(0.01, candidate * (1 + delta));
    }
    const from = new Prisma.Decimal(c.basePrice).toFixed(4);
    const to = new Prisma.Decimal(candidate).toFixed(4);
    perCard.set(c.id, { newPrice: to, hadFetched: true });
    if (from !== to) {
      changes.push({ cardId: c.id, from, to });
    }
  }
  return { changes, perCard };
}

// Top-level refresh orchestrator — fetches all unique set codes in the pool,
// writes Card.basePrice/lastPricedAt/staleSince + batch-inserts PriceSnapshot
// rows, invalidates Redis price:* cache, and returns a summary for the admin
// response + WS broadcast. Accepts optional jitter (0..0.2) as a demo seam.
export async function refreshAllCards(options: { jitter?: number } = {}): Promise<RefreshResult> {
  const jitter = options.jitter ?? 0;
  const cards = await prisma.card.findMany({
    select: { id: true, pokemontcgId: true, setCode: true, basePrice: true },
  });
  const setCodes = [...new Set(cards.map((c) => c.setCode))];

  let upstreamOk = true;
  const combined = new Map<string, number>();
  for (const code of setCodes) {
    try {
      const set = await fetchSetPrices(code);
      for (const [k, v] of set) combined.set(k, v);
    } catch (err) {
      upstreamOk = false;
      console.warn(`pricing.refreshAllCards: upstream failed for ${code}:`, err);
    }
  }

  const { changes, perCard } = buildChanges(cards, combined, jitter);

  const now = new Date();
  const fresh = cards.filter((c) => perCard.get(c.id)?.hadFetched);
  const stale = cards.filter((c) => perCard.get(c.id)?.hadFetched === false);
  const staleCount = stale.length;

  // Bulk update via two UPDATE ... FROM unnest(...) statements plus one
  // createMany — ~3 DB round-trips total vs ~200 for per-card updates. This
  // matters over a pooled connection (Supabase pgbouncer tx mode) where each
  // round-trip is ~50–100ms; per-card loop hits the transaction timeout.
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      if (fresh.length > 0) {
        const ids = fresh.map((c) => c.id);
        const prices = fresh.map((c) => perCard.get(c.id)!.newPrice);
        await tx.$executeRaw`
          UPDATE cards
          SET base_price = v.price::decimal(18, 4),
              last_priced_at = ${now},
              stale_since = NULL
          FROM (
            SELECT unnest(${ids}::uuid[]) AS id,
                   unnest(${prices}::text[]) AS price
          ) AS v
          WHERE cards.id = v.id
        `;
      }
      if (stale.length > 0) {
        const staleIds = stale.map((c) => c.id);
        await tx.$executeRaw`
          UPDATE cards
          SET stale_since = ${now}
          WHERE id = ANY(${staleIds}::uuid[])
        `;
      }
      // Snapshots: one row per fetched card. Stale cards keep their last row
      // as the latest known truth.
      if (fresh.length > 0) {
        const snapshotRows = fresh.map((c) => ({
          cardId: c.id,
          price: perCard.get(c.id)!.newPrice,
          refreshedAt: now,
        }));
        await tx.priceSnapshot.createMany({ data: snapshotRows });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 },
  );

  // Invalidate the Redis cache. Use SCAN → UNLINK so large key sets don't
  // block Redis the way a KEYS+DEL would. Best-effort — if Redis is down, log
  // and continue; DB is the authority.
  try {
    await invalidatePriceCache();
  } catch (err) {
    console.warn("pricing.refreshAllCards: redis invalidation failed:", err);
  }

  return {
    refreshedAt: now.toISOString(),
    totalCards: cards.length,
    changedCount: changes.length,
    staleCount,
    changes,
    upstreamOk,
  };
}

async function invalidatePriceCache(): Promise<void> {
  let cursor = "0";
  const deleted: string[] = [];
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "price:*", "COUNT", 100);
    cursor = next;
    if (keys.length > 0) {
      deleted.push(...keys);
      await redis.unlink(...keys);
    }
  } while (cursor !== "0");
  if (deleted.length > 0) {
    console.log(`pricing: invalidated ${deleted.length} cache keys`);
  }
}

// Cache-through read. Returns the cached price if present + fresh, otherwise null;
// callers fall back to a DB read.
export async function getCachedPrice(
  cardId: string,
): Promise<{ price: string; fetchedAt: string } | null> {
  const cached = await redis.get(`price:${cardId}`);
  if (cached) {
    return JSON.parse(cached) as { price: string; fetchedAt: string };
  }
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { basePrice: true, lastPricedAt: true },
  });
  if (!card) return null;
  const payload = {
    price: card.basePrice.toFixed(4),
    fetchedAt: card.lastPricedAt?.toISOString() ?? new Date().toISOString(),
  };
  await redis.set(`price:${cardId}`, JSON.stringify(payload), "EX", 300);
  return payload;
}

// Exported for tests only.
export const __test__ = { pickBasePrice, FALLBACK_PRICE };
