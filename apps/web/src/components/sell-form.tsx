"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";
type Mode = "listing" | "auction";
type Duration = "2m" | "5m" | "10m";

interface Props {
  userCardId: string;
  name: string;
  imageUrl: string;
  rarity: Rarity;
  marketPrice: string;
  acquiredPrice: string;
  alreadyListed: boolean;
}

export function SellForm(props: Props) {
  const router = useRouter();
  const market = Number(props.marketPrice);
  const [mode, setMode] = useState<Mode>("listing");
  const [priceStr, setPriceStr] = useState(market.toFixed(2));
  const [duration, setDuration] = useState<Duration>("5m");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const price = Number(priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const premium = valid && market > 0 ? ((price - market) / market) * 100 : 0;

  const feeRate = mode === "listing" ? 0.05 : 0.10;
  const fee = useMemo(() => (valid ? Math.ceil(price * feeRate * 100) / 100 : 0), [valid, price, feeRate]);
  const net = useMemo(() => (valid ? price - fee : 0), [valid, price, fee]);

  const submit = async () => {
    setBusy(true);
    setFlash(null);
    try {
      if (mode === "listing") {
        const res = await fetch("/api/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userCardId: props.userCardId, priceAsk: price.toFixed(4) }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) setFlash(`List failed: ${String(body.error ?? res.status)}`);
        else {
          setFlash("Listed. Redirecting…");
          setTimeout(() => router.push(`/market/${String(body.id)}`), 600);
        }
      } else {
        const res = await fetch("/api/auctions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userCardId: props.userCardId,
            startingBid: price.toFixed(4),
            durationKey: duration,
          }),
        });
        const body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) setFlash(`Auction failed: ${String(body.error ?? res.status)}`);
        else {
          setFlash("Auction started. Redirecting…");
          setTimeout(() => router.push(`/auctions/${String(body.id)}`), 600);
        }
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  if (props.alreadyListed) {
    return (
      <div className="rounded-2xl border border-zinc-200 p-6 text-sm dark:border-zinc-800">
        This card is already listed. Manage it from{" "}
        <Link href="/me/listings" className="underline">My listings</Link>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="h-24 w-[68px] shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={props.imageUrl} alt={props.name} className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <div className="font-medium">{props.name}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {props.rarity[0] + props.rarity.slice(1).toLowerCase()} · Paid ${Number(props.acquiredPrice).toFixed(2)} · Market ${market.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
        {(["listing", "auction"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`h-9 px-4 font-medium ${mode === m ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
          >
            {m === "listing" ? "Fixed price" : "Auction"}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">
          {mode === "listing" ? "Ask price (USD)" : "Starting bid (USD)"}
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          className="h-10 rounded-lg border border-zinc-300 bg-white px-3 tabular-nums dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      {mode === "auction" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">Duration</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
            {(["2m", "5m", "10m"] as Duration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`h-8 px-3 font-medium ${duration === d ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-1 text-sm tabular-nums">
        <dt className="text-zinc-500">Premium vs market</dt>
        <dd className={`text-right ${premium > 200 ? "text-red-600" : "text-zinc-500"}`}>
          {valid ? `${premium >= 0 ? "+" : ""}${premium.toFixed(1)}%` : "—"}
        </dd>
        <dt className="text-zinc-500">Platform fee ({(feeRate * 100).toFixed(0)}%, ceil)</dt>
        <dd className="text-right">{valid ? `$${fee.toFixed(2)}` : "—"}</dd>
        <dt className="text-zinc-500">You receive on sale</dt>
        <dd className="text-right font-semibold">{valid ? `$${net.toFixed(2)}` : "—"}</dd>
      </dl>

      {premium > 200 && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          ⚠ This is more than 200% above current market. Listing is allowed but unlikely to sell.
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? (mode === "listing" ? "Listing…" : "Starting…") : (mode === "listing" ? "Confirm listing" : `Start ${duration} auction`)}
        </button>
        <Link
          href="/collection"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </Link>
      </div>

      {flash && <p className="text-xs text-zinc-600 dark:text-zinc-400">{flash}</p>}
    </div>
  );
}
