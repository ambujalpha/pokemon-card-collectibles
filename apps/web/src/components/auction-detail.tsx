"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { subscribeToAuctionRoom, subscribeToPriceUpdates } from "@/lib/ws-client";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type Status = "LIVE" | "CLOSED" | "CANCELLED";

interface Detail {
  id: string;
  status: Status;
  startingBid: string;
  currentBid: string | null;
  currentMarketPrice: string;
  startsAt: string;
  closesAt: string;
  closedAt: string | null;
  extensions: number;
  isOwn: boolean;
  isLeading: boolean;
  iWon: boolean;
  sellerEmail: string;
  winnerEmail: string | null;
  card: {
    id: string; name: string; rarity: Rarity; imageUrl: string;
    lastPricedAt: string | null; staleSince: string | null;
  };
  bids: Array<{ id: string; amount: string; bidder: string; bidderId: string; createdAt: string; isOwn: boolean }>;
}

const RARITY_TONE: Record<Rarity, string> = {
  COMMON: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  UNCOMMON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RARE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  EPIC: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEGENDARY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

function formatCountdown(sec: number): string {
  if (sec <= 0) return "closing…";
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
}

export function AuctionDetail({ auctionId, balance }: { auctionId: string; balance: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = useCallback(() => setReloadNonce((n) => n + 1), []);

  // Refetch detail every reloadNonce change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/auctions/${auctionId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Detail;
        if (cancelled) return;
        setDetail(data);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => { cancelled = true; };
  }, [auctionId, reloadNonce]);

  // WS: live bid + close events, plus price refresh.
  useEffect(() => {
    const off1 = subscribeToAuctionRoom(auctionId, {
      onBid: () => triggerReload(),
      onClosed: () => triggerReload(),
    });
    const off2 = subscribeToPriceUpdates(() => triggerReload());
    return () => { off1(); off2(); };
  }, [auctionId, triggerReload]);

  // Per-second countdown tick. Separate from WS so timer is accurate.
  useEffect(() => {
    const h = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);

  // Auto-refetch when the clock passes closesAt (close worker may be lagging).
  useEffect(() => {
    if (!detail || detail.status !== "LIVE") return;
    const remaining = new Date(detail.closesAt).getTime() - nowTick;
    if (remaining <= 0) {
      const h = setTimeout(() => triggerReload(), 2000);
      return () => clearTimeout(h);
    }
  }, [detail, nowTick, triggerReload]);

  const onBid = async () => {
    if (!detail) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/auctions/${auctionId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: input }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setFlash(`Bid failed: ${String(body.error ?? res.status)}${body.required ? ` (need $${String(body.required)})` : ""}${body.minBid ? ` (min $${String(body.minBid)})` : ""}`);
      } else {
        setFlash(`Bid accepted at $${String(body.amount)}${body.extended ? " — extended +30s" : ""}`);
        setInput("");
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/auctions/${auctionId}`, { method: "DELETE" });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) setFlash(`Cancel failed: ${String(body.error ?? res.status)}`);
      else setFlash("Cancelled. Card returned to your collection.");
    } finally { setBusy(false); }
  };

  if (error) return <p className="text-sm text-red-600">Couldn&apos;t load: {error}</p>;
  if (!detail) return <p className="text-sm text-zinc-500">Loading…</p>;

  const curr = Number(detail.currentBid ?? detail.startingBid);
  const bal = Number(balance);
  const closesAtMs = new Date(detail.closesAt).getTime();
  const remainingSec = Math.max(0, Math.floor((closesAtMs - nowTick) / 1000));
  const endingSoon = remainingSec > 0 && remainingSec < 60;

  // Suggested min next bid, computed client-side (server is authoritative).
  const suggested = detail.currentBid
    ? Math.max(curr * 1.05, curr + 0.10)
    : Number(detail.startingBid);
  const suggestedStr = (Math.ceil(suggested * 100) / 100).toFixed(2);

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <div className="sm:w-1/2">
        <div className="relative aspect-[2.5/3.5] overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={detail.card.imageUrl} alt={detail.card.name} className="h-full w-full object-cover" />
          <span className={`absolute left-2 top-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RARITY_TONE[detail.card.rarity]}`}>
            {detail.card.rarity[0] + detail.card.rarity.slice(1).toLowerCase()}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">{detail.card.name}</h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Seller {detail.sellerEmail}</p>
        </div>

        {detail.status === "LIVE" ? (
          <div className={`rounded-lg border p-3 text-center text-sm tabular-nums ${endingSoon ? "border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300" : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"}`}>
            ⏱ Closes in {formatCountdown(remainingSec)}
            {detail.extensions > 0 && <span className="ml-2 text-xs">(extended {detail.extensions}×)</span>}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            {detail.status === "CLOSED" ? (
              detail.winnerEmail ? (
                detail.iWon
                  ? <span>🏆 You won at ${curr.toFixed(2)}. Card is in your collection.</span>
                  : <span>Closed. Winner: {detail.winnerEmail} at ${curr.toFixed(2)}.</span>
              ) : <span>Closed with no bids. Card returned to seller.</span>
            ) : <span>Cancelled by seller.</span>}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
          <dt className="text-zinc-500">Starting bid</dt>
          <dd className="text-right">${Number(detail.startingBid).toFixed(2)}</dd>
          <dt className="text-zinc-500">Current bid</dt>
          <dd className="text-right font-semibold">
            {detail.currentBid ? `$${Number(detail.currentBid).toFixed(2)}` : "—"}
            {detail.isLeading && <span className="ml-1 text-xs text-emerald-600">(you)</span>}
          </dd>
          <dt className="text-zinc-500">Market price</dt>
          <dd className="text-right">${Number(detail.currentMarketPrice).toFixed(2)}{detail.card.staleSince && <span className="ml-1 text-xs text-amber-600">stale</span>}</dd>
          <dt className="text-zinc-500">Your balance (spendable)</dt>
          <dd className="text-right">${bal.toFixed(2)}</dd>
        </dl>

        {detail.status === "LIVE" && !detail.isOwn && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-500">Your bid (min ${suggestedStr})</span>
              <input
                type="number"
                step="0.01"
                min={suggestedStr}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={suggestedStr}
                className="h-10 rounded-lg border border-zinc-300 bg-white px-3 tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="button"
              onClick={onBid}
              disabled={busy || !input || Number(input) < Number(suggestedStr)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "Placing…" : "Place bid"}
            </button>
            {detail.isLeading && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                You&apos;re the current high bidder. Raising your own bid only holds the delta.
              </p>
            )}
          </div>
        )}

        {detail.status === "LIVE" && detail.isOwn && detail.currentBid === null && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-red-400 px-4 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-700 dark:text-red-300"
          >
            {busy ? "Cancelling…" : "Cancel auction (no bids yet)"}
          </button>
        )}

        {flash && <p className="text-xs">{flash}</p>}

        <div>
          <h2 className="mb-2 text-sm font-semibold">Bid history</h2>
          {detail.bids.length === 0 ? (
            <p className="text-xs text-zinc-500">No bids yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs tabular-nums">
              {detail.bids.map((b) => (
                <li key={b.id} className={`flex justify-between rounded px-2 py-1 ${b.isOwn ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}>
                  <span>${Number(b.amount).toFixed(2)}</span>
                  <span className="text-zinc-500">{b.isOwn ? "you" : b.bidder}</span>
                  <span className="text-zinc-400">{new Date(b.createdAt).toISOString().slice(11, 19)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link href="/auctions" className="text-xs text-zinc-500 underline">← Back to auctions</Link>
      </div>
    </div>
  );
}
