"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { subscribeToAuctionEvents, subscribeToPriceUpdates } from "@/lib/ws-client";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type Sort = "ending_soon" | "newest" | "price_asc" | "price_desc";
type Status = "live" | "closed";

interface Auction {
  id: string;
  startingBid: string;
  currentBid: string | null;
  currentMarketPrice: string;
  closesAt: string;
  status: "LIVE" | "CLOSED" | "CANCELLED";
  isOwn: boolean;
  isLeading: boolean;
  card: { id: string; name: string; rarity: Rarity; imageUrl: string };
}

const RARITIES: Rarity[] = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];
const RARITY_TONE: Record<Rarity, string> = {
  COMMON: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  UNCOMMON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RARE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  EPIC: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEGENDARY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export function AuctionsBrowse() {
  const [items, setItems] = useState<Auction[]>([]);
  const [status, setStatus] = useState<Status>("live");
  const [sort, setSort] = useState<Sort>("ending_soon");
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const triggerReload = useCallback(() => setReloadNonce((n) => n + 1), []);
  const rarityKey = useMemo(() => [...rarities].sort().join(","), [rarities]);

  useEffect(() => {
    const h = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("sort", sort);
    for (const r of rarityKey.split(",").filter(Boolean)) params.append("rarity", r);
    (async () => {
      try {
        const res = await fetch(`/api/auctions?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { auctions: Auction[] };
        if (cancelled) return;
        setItems(data.auctions);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, sort, rarityKey, reloadNonce]);

  useEffect(() => {
    const off1 = subscribeToAuctionEvents(() => triggerReload());
    const off2 = subscribeToPriceUpdates(() => triggerReload());
    // 10s refresh for countdown accuracy even without WS events.
    const interval = setInterval(() => triggerReload(), 10_000);
    return () => { off1(); off2(); clearInterval(interval); };
  }, [triggerReload]);

  const toggleRarity = (r: Rarity) => {
    setRarities((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  };

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">Couldn&apos;t load: {error}</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
          {(["live", "closed"] as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`h-8 px-3 ${status === s ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="ending_soon">Ending soonest</option>
          <option value="newest">Newest</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
        </select>
        <span className="mx-2 text-zinc-300 dark:text-zinc-700">|</span>
        {RARITIES.map((r) => {
          const active = rarities.has(r);
          return (
            <button
              type="button"
              key={r}
              onClick={() => toggleRarity(r)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {r[0] + r.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Nothing {status === "live" ? "live" : "closed"} right now.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((a) => (
            <li key={a.id}>
              <AuctionTile a={a} nowTick={nowTick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuctionTile({ a, nowTick }: { a: Auction; nowTick: number }) {
  const price = Number(a.currentBid ?? a.startingBid);
  const remainingSec = Math.max(0, Math.floor((new Date(a.closesAt).getTime() - nowTick) / 1000));
  const remaining = remainingSec > 3600
    ? `${Math.floor(remainingSec / 3600)}h ${Math.floor((remainingSec % 3600) / 60)}m`
    : remainingSec > 60
    ? `${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s`
    : `${remainingSec}s`;
  const endingSoon = remainingSec > 0 && remainingSec < 60;

  return (
    <Link
      href={`/auctions/${a.id}`}
      className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.card.imageUrl} alt={a.card.name} className="h-full w-full object-cover" />
        <span className={`absolute left-1 top-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RARITY_TONE[a.card.rarity]}`}>
          {a.card.rarity[0] + a.card.rarity.slice(1).toLowerCase()}
        </span>
        {a.isOwn && (
          <span className="absolute right-1 top-1 inline-flex rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-white">Yours</span>
        )}
        {a.isLeading && !a.isOwn && (
          <span className="absolute right-1 top-1 inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white">Leading</span>
        )}
      </div>
      <div className="truncate text-sm font-medium">{a.card.name}</div>
      <div className="flex items-baseline justify-between tabular-nums">
        <span className="text-base font-semibold">${price.toFixed(2)}</span>
        {a.status === "LIVE" ? (
          <span className={`text-xs ${endingSoon ? "text-red-600" : "text-zinc-500"}`}>⏱ {remaining}</span>
        ) : (
          <span className="text-xs text-zinc-500">Closed</span>
        )}
      </div>
    </Link>
  );
}
