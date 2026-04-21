import { PrismaClient, Rarity } from "@prisma/client";

import { mapRarity } from "../src/lib/rarity-map";

const prisma = new PrismaClient();
const SET_ID = "sv2"; // Scarlet & Violet — Paldea Evolved (locked: PHASE_1.md §A1)
const TARGET_POOL_SIZE = 200;
const FALLBACK_PRICE = 0.25;

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

function pickBasePrice(card: TcgCard): { price: number; usedFallback: boolean } {
  const priceSets = card.tcgplayer?.prices;
  if (!priceSets) return { price: FALLBACK_PRICE, usedFallback: true };
  const preferred = [
    "holofoil",
    "normal",
    "reverseHolofoil",
    "1stEditionHolofoil",
    "unlimitedHolofoil",
  ];
  for (const key of preferred) {
    const p = priceSets[key];
    if (p?.market != null) return { price: p.market, usedFallback: false };
    if (p?.mid != null) return { price: p.mid, usedFallback: false };
  }
  for (const p of Object.values(priceSets)) {
    if (p?.market != null) return { price: p.market, usedFallback: false };
    if (p?.mid != null) return { price: p.mid, usedFallback: false };
  }
  return { price: FALLBACK_PRICE, usedFallback: true };
}

async function main() {
  console.log(`Fetching set ${SET_ID} from pokemontcg.io...`);
  const res = await fetch(
    `https://api.pokemontcg.io/v2/cards?q=set.id:${SET_ID}&pageSize=250`,
  );
  if (!res.ok) throw new Error(`pokemontcg.io returned ${res.status}`);
  const { data } = (await res.json()) as { data: TcgCard[] };
  console.log(`Got ${data.length} cards total.`);

  type Mapped = { tcg: TcgCard; bucket: Rarity };
  const mapped: Mapped[] = [];
  const unknown = new Map<string, number>();
  for (const c of data) {
    const b = mapRarity(c.rarity);
    if (!b) {
      const key = c.rarity ?? "(none)";
      unknown.set(key, (unknown.get(key) ?? 0) + 1);
      continue;
    }
    mapped.push({ tcg: c, bucket: b });
  }
  if (unknown.size > 0) {
    console.warn("Skipped cards with unmapped rarity:");
    for (const [r, n] of unknown) console.warn(`  ${r}: ${n}`);
  }

  const byBucket: Record<Rarity, Mapped[]> = {
    COMMON: [],
    UNCOMMON: [],
    RARE: [],
    EPIC: [],
    LEGENDARY: [],
  };
  for (const m of mapped) byBucket[m.bucket].push(m);

  // Keep all EPIC + LEGENDARY; fill remaining with C/U/R pro-rata (PHASE_1.md §2.1).
  const keep: Mapped[] = [...byBucket.EPIC, ...byBucket.LEGENDARY];
  const remaining = Math.max(0, TARGET_POOL_SIZE - keep.length);
  const lowCounts = {
    COMMON: byBucket.COMMON.length,
    UNCOMMON: byBucket.UNCOMMON.length,
    RARE: byBucket.RARE.length,
  };
  const lowTotal = lowCounts.COMMON + lowCounts.UNCOMMON + lowCounts.RARE;
  const alloc =
    lowTotal === 0
      ? { COMMON: 0, UNCOMMON: 0, RARE: 0 }
      : {
          COMMON: Math.floor((remaining * lowCounts.COMMON) / lowTotal),
          UNCOMMON: Math.floor((remaining * lowCounts.UNCOMMON) / lowTotal),
          RARE: Math.floor((remaining * lowCounts.RARE) / lowTotal),
        };
  let allocated = alloc.COMMON + alloc.UNCOMMON + alloc.RARE;
  while (allocated < remaining && alloc.COMMON < lowCounts.COMMON) {
    alloc.COMMON++;
    allocated++;
  }
  for (const b of ["COMMON", "UNCOMMON", "RARE"] as const) {
    keep.push(...byBucket[b].slice(0, alloc[b]));
  }

  const kept: Record<Rarity, number> = {
    COMMON: 0,
    UNCOMMON: 0,
    RARE: 0,
    EPIC: 0,
    LEGENDARY: 0,
  };
  for (const k of keep) kept[k.bucket]++;
  console.log(`Keeping ${keep.length} cards. Bucket totals:`);
  for (const [b, n] of Object.entries(kept)) console.log(`  ${b}: ${n}`);

  await prisma.card.deleteMany({});
  console.log("Cleared existing cards.");

  let fallbackCount = 0;
  for (const m of keep) {
    const { price, usedFallback } = pickBasePrice(m.tcg);
    if (usedFallback) fallbackCount++;
    await prisma.card.create({
      data: {
        pokemontcgId: m.tcg.id,
        name: m.tcg.name,
        setCode: SET_ID,
        number: m.tcg.number,
        rarityBucket: m.bucket,
        imageUrl: m.tcg.images.small,
        basePrice: price.toFixed(4),
      },
    });
  }
  console.log(
    `Seeded ${keep.length} cards. ${fallbackCount} used fallback price ($${FALLBACK_PRICE.toFixed(2)}).`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
