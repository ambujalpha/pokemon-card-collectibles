"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { subscribeToListingUpdates, subscribeToPriceUpdates } from "@/lib/ws-client";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type SortKey = "value_desc" | "acquired_desc" | "pnl_desc";
type CardStatus = "HELD" | "LISTED";

interface Row {
  userCardId: string;
  status: CardStatus;
  cardId: string;
  name: string;
  pokemontcgId: string;
  rarity: Rarity;
  imageUrl: string;
  acquiredAt: string;
  acquiredPrice: string;
  currentPrice: string;
  lastPricedAt: string | null;
  staleSince: string | null;
  pnlAbs: string;
  pnlPct: string;
  listing: { id: string; priceAsk: string; createdAt: string } | null;
}

interface Totals {
  count: number;
  totalSpent: string;
  totalCurrent: string;
  totalPnl: string;
  totalPnlPct: string;
}

const RARITY_TONE: Record<Rarity, string> = {
  COMMON: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  UNCOMMON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RARE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  EPIC: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEGENDARY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "value_desc", label: "Value ↓" },
  { value: "acquired_desc", label: "Acquired ↓" },
  { value: "pnl_desc", label: "P&L ↓" },
];

const RARITIES: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

export function CollectionView() {
  const [sort, setSort] = useState<SortKey>("value_desc");
  const [rarityFilters, setRarityFilters] = useState<Set<Rarity>>(new Set());
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("sort", sort);
    for (const r of rarityFilters) params.append("rarity", r);
    (async () => {
      try {
        const res = await fetch(`/api/collection?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { cards: Row[]; totals: Totals };
        if (cancelled) return;
        setRows(data.cards);
        setTotals(data.totals);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sort, rarityFilters, reloadNonce]);

  useEffect(() => {
    const off1 = subscribeToPriceUpdates(() => triggerReload());
    const off2 = subscribeToListingUpdates(() => triggerReload());
    return () => { off1(); off2(); };
  }, [triggerReload]);

  const toggleRarity = (r: Rarity) => {
    setRarityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  const totalsPnlTone = useMemo(() => {
    if (!totals) return "text-zinc-500";
    const n = Number(totals.totalPnl);
    return n > 0 ? "text-emerald-600 dark:text-emerald-400"
      : n < 0 ? "text-red-600 dark:text-red-400"
      : "text-zinc-500";
  }, [totals]);

  if (loading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">Couldn&apos;t load: {error}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {totals && (
        <section className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-4">
          <Summary label="Cards" value={String(totals.count)} />
          <Summary label="Spent" value={`$${Number(totals.totalSpent).toFixed(2)}`} />
          <Summary label="Current value" value={`$${Number(totals.totalCurrent).toFixed(2)}`} />
          <Summary
            label="P&L"
            value={`${Number(totals.totalPnl) >= 0 ? "+" : ""}$${Number(totals.totalPnl).toFixed(2)} (${totals.totalPnlPct}%)`}
            tone={totalsPnlTone}
          />
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">Sort</label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="mx-2 text-zinc-300 dark:text-zinc-700">|</span>
        {RARITIES.map((r) => {
          const active = rarityFilters.has(r);
          return (
            <button
              type="button"
              key={r}
              onClick={() => toggleRarity(r)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {r[0] + r.slice(1).toLowerCase()}
            </button>
          );
        })}
      </section>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rows.map((r) => (
            <li key={r.userCardId}>
              <CardTile row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function CardTile({ row }: { row: Row }) {
  const pnlNum = Number(row.pnlAbs);
  const pnlTone =
    pnlNum > 0 ? "text-emerald-600 dark:text-emerald-400"
    : pnlNum < 0 ? "text-red-600 dark:text-red-400"
    : "text-zinc-500";
  const stale = row.staleSince !== null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={row.imageUrl} alt={row.name} className="h-full w-full object-cover" />
        <span
          className={`absolute left-1 top-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RARITY_TONE[row.rarity]}`}
        >
          {row.rarity[0] + row.rarity.slice(1).toLowerCase()}
        </span>
        {row.status === "LISTED" && (
          <span className="absolute right-1 top-1 inline-flex items-center rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white">
            Listed ${Number(row.listing?.priceAsk ?? 0).toFixed(2)}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{row.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        <span>Paid</span>
        <span className="text-right">${Number(row.acquiredPrice).toFixed(2)}</span>
        <span>Now</span>
        <span className="text-right">
          ${Number(row.currentPrice).toFixed(2)}
          {stale && <span className="ml-1 text-amber-600">·stale</span>}
        </span>
        <span>P&L</span>
        <span className={`text-right ${pnlTone}`}>
          {pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)} ({row.pnlPct}%)
        </span>
      </div>
      {row.status === "HELD" ? (
        <Link
          href={`/sell/${row.userCardId}`}
          className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-300 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Sell
        </Link>
      ) : (
        <Link
          href={`/market/${row.listing?.id}`}
          className="inline-flex h-8 items-center justify-center rounded-lg border border-sky-300 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/30"
        >
          View listing
        </Link>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      No cards yet.{" "}
      <Link href="/drops" className="underline">Buy a pack</Link> to start your collection.
    </div>
  );
}
