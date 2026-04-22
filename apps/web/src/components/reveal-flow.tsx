"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Decimal } from "@/lib/money";
import { FLIP_MS, INTER_CARD_GAP_MS } from "@/lib/reveal-pacing";
import { computeRevealPnl } from "@/lib/reveal-pnl";
import { subscribeToPriceUpdates } from "@/lib/ws-client";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type Tier = "STARTER" | "PREMIUM" | "ULTRA";

interface RevealedCard {
  position: number;
  cardId: string;
  pokemontcgId: string;
  name: string;
  rarity: Rarity;
  imageUrl: string;
  pricedCaptured: string;
  basePrice: string;
  lastPricedAt: string | null;
  staleSince: string | null;
}

interface RevealedPack {
  id: string;
  dropId: string;
  packTier: Tier;
  purchasedAt: string;
  isRevealed: boolean;
}

interface Props {
  packId: string;
  mode: "animate" | "static";
  tierPrices: Record<Tier, string>;
}

type Phase =
  | { kind: "loading" }
  | { kind: "animating"; revealedCount: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function RevealFlow({ packId, mode, tierPrices }: Props) {
  const [pack, setPack] = useState<RevealedPack | null>(null);
  const [cards, setCards] = useState<RevealedCard[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  // Tracks cardIds whose price changed in the most recent WS event so the
  // tile can flash green/red briefly. Cleared on a timer.
  const [flashingDirection, setFlashingDirection] = useState<Map<string, "up" | "down">>(
    new Map(),
  );
  const fetchedRef = useRef(false);

  // Fire the API call once on mount. Strict mode + dev double-invoke guard via ref.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        if (mode === "static") {
          const res = await fetch(`/api/packs/${packId}/contents`);
          if (!res.ok) return setPhase({ kind: "error", message: mapFetchError(res.status) });
          const data = (await res.json()) as { pack: RevealedPack; cards: RevealedCard[] };
          setPack(data.pack);
          setCards(data.cards);
          setPhase({ kind: "done" });
          return;
        }

        const res = await fetch(`/api/packs/${packId}/reveal`, { method: "POST" });
        if (res.status === 409) {
          // Race: another tab already revealed. Fall through to static fetch.
          const staticRes = await fetch(`/api/packs/${packId}/contents`);
          if (!staticRes.ok) return setPhase({ kind: "error", message: mapFetchError(staticRes.status) });
          const data = (await staticRes.json()) as { pack: RevealedPack; cards: RevealedCard[] };
          setPack(data.pack);
          setCards(data.cards);
          setPhase({ kind: "done" });
          return;
        }
        if (!res.ok) return setPhase({ kind: "error", message: mapFetchError(res.status) });
        const data = (await res.json()) as { pack: RevealedPack; cards: RevealedCard[] };
        setPack(data.pack);
        setCards(data.cards);
        setPhase({ kind: "animating", revealedCount: 0 });
      } catch {
        setPhase({ kind: "error", message: "Something went wrong. Try again from My packs." });
      }
    })();
  }, [packId, mode]);

  // Subscribe to price refresh events. Active once the pack has loaded; works
  // in both animate (after completion) and static mode. Re-fetches contents
  // and computes per-card direction (up/down) for the flash overlay.
  useEffect(() => {
    if (!pack) return;
    const unsub = subscribeToPriceUpdates(async ({ changes }) => {
      const ourCardIds = new Set(cards.map((c) => c.cardId));
      const relevant = changes.filter((c) => ourCardIds.has(c.cardId));
      if (relevant.length === 0) return;
      const directions = new Map<string, "up" | "down">();
      for (const ch of relevant) {
        const dir = Number(ch.to) > Number(ch.from) ? "up" : "down";
        directions.set(ch.cardId, dir);
      }
      // Re-fetch the canonical contents (server is authoritative on price + timestamps).
      try {
        const res = await fetch(`/api/packs/${pack.id}/contents`);
        if (res.ok) {
          const data = (await res.json()) as { cards: RevealedCard[] };
          setCards(data.cards);
        }
      } catch {
        // Network blip — skip; next event will re-sync.
      }
      setFlashingDirection(directions);
      window.setTimeout(() => setFlashingDirection(new Map()), 800);
    });
    return unsub;
  }, [pack, cards]);

  // Step the animation: wait FLIP_MS[rarity] + gap per card, bumping revealedCount
  // until all cards are flipped, then transition to "done". setPhase is only called
  // inside the timer callback (never synchronously during the effect body).
  useEffect(() => {
    if (phase.kind !== "animating") return;
    if (cards.length === 0) return;
    const nextIdx = phase.revealedCount;
    if (nextIdx >= cards.length) return;
    const next = cards[nextIdx];
    const delay = FLIP_MS[next.rarity] + INTER_CARD_GAP_MS;
    const t = window.setTimeout(() => {
      setPhase((p) => {
        if (p.kind !== "animating") return p;
        const newCount = p.revealedCount + 1;
        return newCount >= cards.length
          ? { kind: "done" }
          : { kind: "animating", revealedCount: newCount };
      });
    }, delay);
    return () => window.clearTimeout(t);
  }, [phase, cards]);

  if (phase.kind === "loading") {
    return (
      <div className="flex min-h-[20rem] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
          Opening…
        </div>
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
        {phase.message}{" "}
        <Link href="/me/packs" className="underline">
          Back to My packs
        </Link>
      </div>
    );
  }

  const revealedCount = phase.kind === "animating" ? phase.revealedCount : cards.length;
  const tierPriceStr = pack ? tierPrices[pack.packTier] : "0";
  const pnl = computeRevealPnl(tierPriceStr, cards);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {pack?.packTier} pack · {cards.length} cards
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {phase.kind === "done" ? "Pack revealed" : "Revealing…"}
          </h1>
        </div>
        {phase.kind === "animating" ? (
          <button
            type="button"
            onClick={() => setPhase({ kind: "done" })}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-300 px-4 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Skip
          </button>
        ) : null}
      </header>

      <CardFlipStack
        cards={cards}
        revealedCount={revealedCount}
        flashingDirection={flashingDirection}
      />

      {phase.kind === "done" ? (
        <RevealSummary
          spent={pnl.spent}
          atPullValue={pnl.atPullValue}
          currentValue={pnl.currentValue}
          atPullDelta={pnl.atPullDelta}
          currentDelta={pnl.currentDelta}
          atPullPct={pnl.atPullPct}
          currentPct={pnl.currentPct}
        />
      ) : null}
    </section>
  );
}

function CardFlipStack({
  cards,
  revealedCount,
  flashingDirection,
}: {
  cards: RevealedCard[];
  revealedCount: number;
  flashingDirection: Map<string, "up" | "down">;
}) {
  if (cards.length === 0) return null;
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5"
      style={{ perspective: "1200px" }}
    >
      {cards.map((c, idx) => (
        <CardFlip
          key={c.position}
          card={c}
          revealed={idx < revealedCount}
          flash={flashingDirection.get(c.cardId)}
        />
      ))}
    </div>
  );
}

const RARITY_TONE: Record<Rarity, string> = {
  COMMON: "border-zinc-300 dark:border-zinc-700",
  UNCOMMON: "border-emerald-400 dark:border-emerald-700",
  RARE: "border-sky-400 dark:border-sky-600",
  EPIC: "border-violet-400 dark:border-violet-600",
  LEGENDARY: "border-amber-400 dark:border-amber-500",
};

const RARITY_BADGE: Record<Rarity, string> = {
  COMMON: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  UNCOMMON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RARE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  EPIC: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEGENDARY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

function CardFlip({
  card,
  revealed,
  flash,
}: {
  card: RevealedCard;
  revealed: boolean;
  flash?: "up" | "down";
}) {
  const duration = FLIP_MS[card.rarity];
  const pull = new Decimal(card.pricedCaptured);
  const now = new Decimal(card.basePrice);
  const delta = now.sub(pull);
  const deltaSign = delta.isZero() ? "•" : delta.isPositive() ? "▲" : "▼";
  const deltaTone = delta.isZero()
    ? "text-zinc-500 dark:text-zinc-400"
    : delta.isPositive()
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  const flashRing =
    flash === "up"
      ? "ring-4 ring-emerald-400/60"
      : flash === "down"
        ? "ring-4 ring-red-400/60"
        : "ring-0 ring-transparent";

  return (
    <div
      className={`relative aspect-[5/7] w-full rounded-xl transition-all duration-700 ${flashRing}`}
      style={{ transformStyle: "preserve-3d", perspective: "1200px" }}
    >
      <div
        className="absolute inset-0 transition-transform ease-in-out"
        style={{
          transformStyle: "preserve-3d",
          transitionDuration: `${duration}ms`,
          transform: revealed ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Back */}
        <div
          className={`absolute inset-0 flex items-center justify-center rounded-xl border-2 ${RARITY_TONE[card.rarity]} bg-gradient-to-br from-zinc-900 to-zinc-700 dark:from-zinc-950 dark:to-zinc-800`}
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <div className="flex flex-col items-center gap-1 text-zinc-200">
            <div className="text-xs uppercase tracking-widest opacity-60">PullVault</div>
            <div className="text-2xl">?</div>
          </div>
        </div>
        {/* Front */}
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden rounded-xl border-2 bg-white ${RARITY_TONE[card.rarity]} dark:bg-zinc-950`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card.imageUrl}
            alt={card.name}
            className="h-full w-full object-contain"
            loading="lazy"
          />
          <div className="absolute left-2 top-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RARITY_BADGE[card.rarity]}`}
            >
              {card.rarity}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 via-black/50 to-transparent px-2 py-2 text-[10px] text-white">
            <div className="truncate font-medium">{card.name}</div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="opacity-80">At pull ${pull.toFixed(2)}</span>
              <span className={`font-medium ${deltaTone}`}>
                {deltaSign} ${now.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[9px] opacity-60">
              <span>{formatAsOf(card.lastPricedAt)}</span>
              {card.staleSince ? <span className="text-amber-300">stale</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RevealSummary({
  spent,
  atPullValue,
  currentValue,
  atPullDelta,
  currentDelta,
  atPullPct,
  currentPct,
}: {
  spent: Decimal;
  atPullValue: Decimal;
  currentValue: Decimal;
  atPullDelta: Decimal;
  currentDelta: Decimal;
  atPullPct: Decimal;
  currentPct: Decimal;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Summary
      </h2>
      <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <SummaryRow label="Spent" value={`$${spent.toFixed(2)}`} />
        <SummaryRow
          label="At-pull value"
          value={`$${atPullValue.toFixed(2)}`}
          sub={formatDelta(atPullDelta, atPullPct)}
          subTone={tone(atPullDelta)}
        />
        <SummaryRow
          label="Current value"
          value={`$${currentValue.toFixed(2)}`}
          sub={formatDelta(currentDelta, currentPct)}
          subTone={tone(currentDelta)}
        />
      </dl>
      <div className="mt-6">
        <Link
          href="/me/packs?tab=opened"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Back to My packs
        </Link>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {sub ? <div className={`mt-1 text-xs tabular-nums ${subTone ?? ""}`}>{sub}</div> : null}
    </div>
  );
}

function formatDelta(delta: Decimal, pct: Decimal): string {
  const sign = delta.isZero() ? "±" : delta.isPositive() ? "+" : "−";
  const abs = delta.abs();
  const pctAbs = pct.abs();
  return `${sign}$${abs.toFixed(2)} (${sign === "−" ? "−" : sign === "+" ? "+" : ""}${pctAbs.toFixed(1)}%)`;
}

function tone(delta: Decimal): string {
  if (delta.isZero()) return "text-zinc-500 dark:text-zinc-400";
  return delta.isPositive()
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
}

function formatAsOf(iso: string | null): string {
  if (!iso) return "as of seed";
  const d = new Date(iso);
  return `as of ${d.toISOString().slice(11, 16)} UTC`;
}

function mapFetchError(status: number): string {
  if (status === 401) return "Please sign in to open this pack.";
  if (status === 403) return "This pack isn't yours.";
  if (status === 404) return "Pack not found.";
  if (status === 409) return "This pack can't be opened right now.";
  return "Something went wrong opening this pack.";
}
