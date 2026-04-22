"use client";

import { useEffect, useState } from "react";

import { ConfirmPurchaseModal } from "./confirm-purchase-modal";
import { DropCountdown } from "./drop-countdown";
import { subscribeToDropInventory } from "@/lib/ws-client";

type Tier = "STARTER" | "PREMIUM" | "ULTRA";
type Status = "SCHEDULED" | "LIVE" | "ENDED" | "SOLD_OUT";

export interface DropDetailData {
  id: string;
  packTier: Tier;
  totalInventory: number;
  remaining: number;
  startsAt: string;
  endsAt: string;
  status: Status;
}

interface Props {
  initial: DropDetailData;
  userBalanceUsd: string;
  priceUsd: string;
  publishedOddsPct: Record<"COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY", string>;
}

const TIER_LABEL: Record<Tier, { name: string; ev: string }> = {
  STARTER: { name: "Starter", ev: "65%" },
  PREMIUM: { name: "Premium", ev: "75%" },
  ULTRA: { name: "Ultra", ev: "85%" },
};

function recomputeStatus(d: Pick<DropDetailData, "startsAt" | "endsAt" | "remaining">): Status {
  if (d.remaining <= 0) return "SOLD_OUT";
  const now = Date.now();
  if (now < new Date(d.startsAt).getTime()) return "SCHEDULED";
  if (now >= new Date(d.endsAt).getTime()) return "ENDED";
  return "LIVE";
}

export function DropDetail({ initial, userBalanceUsd, priceUsd, publishedOddsPct }: Props) {
  const [drop, setDrop] = useState<DropDetailData>(initial);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeToDropInventory(drop.id, ({ remaining }) => {
      setDrop((d) => ({ ...d, remaining, status: recomputeStatus({ ...d, remaining }) }));
    });
    return unsub;
  }, [drop.id]);

  // Tick once per second so status can flip when startsAt / endsAt is crossed.
  useEffect(() => {
    const t = setInterval(() => {
      setDrop((d) => ({ ...d, status: recomputeStatus(d) }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const tier = TIER_LABEL[drop.packTier];
  const canBuy = drop.status === "LIVE";

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {tier.ev} EV · {drop.packTier}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{tier.name} pack</h1>
        </div>
        <StatusBadge status={drop.status} />
      </div>

      <div className="mt-6 flex items-baseline gap-3">
        <div className="text-4xl font-semibold tabular-nums">${priceUsd}</div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">per pack (5 cards)</div>
      </div>

      <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{drop.remaining}</span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">of {drop.totalInventory} packs remaining</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-zinc-900 transition-all dark:bg-zinc-100"
            style={{ width: `${(drop.remaining / drop.totalInventory) * 100}%` }}
          />
        </div>
        <div className="mt-3">
          {drop.status === "SCHEDULED" ? (
            <DropCountdown to={drop.startsAt} label="Opens in" />
          ) : drop.status === "LIVE" ? (
            <DropCountdown to={drop.endsAt} label="Ends in" />
          ) : null}
        </div>
      </div>

      <div className="mt-6">
        <button
          type="button"
          disabled={!canBuy}
          onClick={() => setModalOpen(true)}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {drop.status === "LIVE"
            ? "Buy 1 Pack"
            : drop.status === "SOLD_OUT"
              ? "Sold out"
              : drop.status === "ENDED"
                ? "Ended"
                : "Opens soon"}
        </button>
      </div>

      <ConfirmPurchaseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        dropId={drop.id}
        packTier={drop.packTier}
        priceUsd={priceUsd}
        userBalanceUsd={userBalanceUsd}
        publishedOddsPct={publishedOddsPct}
      />
    </section>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const { tone, label } =
    status === "LIVE"
      ? { tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", label: "Live" }
      : status === "SCHEDULED"
        ? { tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300", label: "Scheduled" }
        : status === "SOLD_OUT"
          ? { tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300", label: "Sold out" }
          : { tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", label: "Ended" };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
