"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { subscribeToListingUpdates, subscribeToPriceUpdates } from "@/lib/ws-client";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type Status = "ACTIVE" | "SOLD" | "CANCELLED";

interface Detail {
  id: string;
  status: Status;
  priceAsk: string;
  currentMarketPrice: string;
  createdAt: string;
  soldAt: string | null;
  cancelledAt: string | null;
  isOwn: boolean;
  sellerEmail: string;
  card: {
    id: string;
    name: string;
    rarity: Rarity;
    imageUrl: string;
    lastPricedAt: string | null;
    staleSince: string | null;
  };
}

const RARITY_TONE: Record<Rarity, string> = {
  COMMON: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300",
  UNCOMMON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RARE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  EPIC: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LEGENDARY: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export function ListingDetail({ listingId, buyerBalance }: { listingId: string; buyerBalance: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/listings/${listingId}`, { cache: "no-store" });
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
  }, [listingId, reloadNonce]);

  useEffect(() => {
    const off1 = subscribeToListingUpdates((p) => { if (p.listingId === listingId) triggerReload(); });
    const off2 = subscribeToPriceUpdates(() => triggerReload());
    return () => { off1(); off2(); };
  }, [listingId, triggerReload]);

  const onBuy = async () => {
    if (!detail) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/purchase`, { method: "POST" });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setFlash(`Purchase failed: ${String(body.error ?? res.status)}`);
      } else {
        setFlash("Purchased. Redirecting to collection…");
        setTimeout(() => router.push("/collection"), 800);
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
      const res = await fetch(`/api/listings/${listingId}`, { method: "DELETE" });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setFlash(`Cancel failed: ${String(body.error ?? res.status)}`);
      } else {
        setFlash("Cancelled. Card returned to your collection.");
        triggerReload();
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-sm text-red-600">Couldn&apos;t load: {error}</p>;
  if (!detail) return <p className="text-sm text-zinc-500">Loading…</p>;

  const ask = Number(detail.priceAsk);
  const mkt = Number(detail.currentMarketPrice);
  const balance = Number(buyerBalance);
  const premium = mkt > 0 ? ((ask - mkt) / mkt) * 100 : 0;
  const highPremium = premium > 200;

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
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Listed by {detail.sellerEmail} · {new Date(detail.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
          <dt className="text-zinc-500">Ask</dt>
          <dd className="text-right font-semibold">${ask.toFixed(2)}</dd>
          <dt className="text-zinc-500">Current market</dt>
          <dd className="text-right">
            ${mkt.toFixed(2)}
            {detail.card.staleSince && <span className="ml-1 text-xs text-amber-600">stale</span>}
          </dd>
          <dt className="text-zinc-500">Premium over market</dt>
          <dd className={`text-right ${highPremium ? "text-red-600" : "text-zinc-500"}`}>
            {premium >= 0 ? "+" : ""}{premium.toFixed(1)}%
          </dd>
          <dt className="text-zinc-500">Your balance</dt>
          <dd className="text-right">${balance.toFixed(2)}</dd>
        </dl>

        {highPremium && detail.status === "ACTIVE" && !detail.isOwn && (
          <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            ⚠ This listing is priced more than 200% above current market. Double-check before buying.
          </div>
        )}

        {detail.status === "ACTIVE" && !detail.isOwn && balance < ask && (
          <div className="rounded-lg border border-red-400 bg-red-50 p-3 text-xs text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
            Not enough funds. <Link href="/" className="underline">Add funds</Link>.
          </div>
        )}

        {detail.status !== "ACTIVE" && (
          <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
            This listing is <span className="font-semibold">{detail.status}</span>
            {detail.soldAt && ` · sold ${new Date(detail.soldAt).toISOString().slice(0, 16).replace("T", " ")} UTC`}
            {detail.cancelledAt && ` · cancelled ${new Date(detail.cancelledAt).toISOString().slice(0, 16).replace("T", " ")} UTC`}
          </div>
        )}

        <div className="flex gap-2">
          {detail.status === "ACTIVE" && !detail.isOwn && (
            <button
              type="button"
              onClick={onBuy}
              disabled={busy || balance < ask}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "Buying…" : `Buy for $${ask.toFixed(2)}`}
            </button>
          )}
          {detail.status === "ACTIVE" && detail.isOwn && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-red-400 px-4 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-700 dark:text-red-300"
            >
              {busy ? "Cancelling…" : "Cancel listing"}
            </button>
          )}
          <Link
            href="/market"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Back
          </Link>
        </div>

        {flash && <p className="text-xs text-zinc-600 dark:text-zinc-400">{flash}</p>}
      </div>
    </div>
  );
}
