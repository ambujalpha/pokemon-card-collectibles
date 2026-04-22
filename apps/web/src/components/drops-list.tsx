"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DropCountdown } from "./drop-countdown";

export type DropSummary = {
  id: string;
  packTier: "STARTER" | "PREMIUM" | "ULTRA";
  totalInventory: number;
  remaining: number;
  startsAt: string;
  endsAt: string;
  status: "SCHEDULED" | "LIVE" | "ENDED" | "SOLD_OUT";
};

const TIER_LABEL: Record<DropSummary["packTier"], { name: string; price: string; ev: string }> = {
  STARTER: { name: "Starter", price: "$5", ev: "65% EV" },
  PREMIUM: { name: "Premium", price: "$20", ev: "75% EV" },
  ULTRA: { name: "Ultra", price: "$50", ev: "85% EV" },
};

const POLL_MS = 30_000;

export function DropsList({ initial }: { initial: DropSummary[] }) {
  const [drops, setDrops] = useState<DropSummary[]>(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/drops", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { drops: DropSummary[] };
        if (!cancelled) setDrops(body.drops);
      } catch {
        /* transient network error — next tick will retry */
      }
    };
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (drops.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No drops scheduled yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {drops.map((d) => (
        <DropCard key={d.id} drop={d} />
      ))}
    </div>
  );
}

function DropCard({ drop }: { drop: DropSummary }) {
  const tier = TIER_LABEL[drop.packTier];
  const statusBadge =
    drop.status === "LIVE" ? (
      <Badge tone="green">Live</Badge>
    ) : drop.status === "SCHEDULED" ? (
      <Badge tone="blue">Scheduled</Badge>
    ) : drop.status === "SOLD_OUT" ? (
      <Badge tone="red">Sold out</Badge>
    ) : (
      <Badge tone="gray">Ended</Badge>
    );

  return (
    <Link
      href={`/drops/${drop.id}`}
      className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{tier.ev}</div>
          <div className="mt-0.5 text-lg font-semibold tracking-tight">{tier.name}</div>
        </div>
        {statusBadge}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{tier.price}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">per pack</span>
      </div>
      <div className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium tabular-nums">{drop.remaining}</span>
        <span className="text-zinc-500 dark:text-zinc-400"> / {drop.totalInventory} left</span>
      </div>
      <div className="mt-3">
        {drop.status === "SCHEDULED" ? (
          <DropCountdown to={drop.startsAt} label="Opens in" />
        ) : drop.status === "LIVE" ? (
          <DropCountdown to={drop.endsAt} label="Ends in" />
        ) : null}
      </div>
    </Link>
  );
}

function Badge({ tone, children }: { tone: "green" | "blue" | "red" | "gray"; children: React.ReactNode }) {
  const cls =
    tone === "green"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : tone === "blue"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
        : tone === "red"
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
  );
}
