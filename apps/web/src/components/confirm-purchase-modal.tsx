"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Tier = "STARTER" | "PREMIUM" | "ULTRA";

interface Props {
  open: boolean;
  onClose: () => void;
  dropId: string;
  packTier: Tier;
  priceUsd: string;
  userBalanceUsd: string;
  publishedOddsPct: Record<"COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY", string>;
}

const TIER_LABEL: Record<Tier, string> = {
  STARTER: "Starter",
  PREMIUM: "Premium",
  ULTRA: "Ultra",
};

export function ConfirmPurchaseModal({
  open,
  onClose,
  dropId,
  packTier,
  priceUsd,
  userBalanceUsd,
  publishedOddsPct,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const insufficient = Number(userBalanceUsd) < Number(priceUsd);

  async function onConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/drops/${dropId}/purchase`, { method: "POST" });
      if (res.ok) {
        setSubmitting(false);
        onClose();
        router.push("/me/packs");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setError(errorMessage(body.error));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold tracking-tight">Buy 1 {TIER_LABEL[packTier]} pack?</h2>

        <dl className="mt-4 space-y-1 text-sm">
          <Row label="Price">${priceUsd}</Row>
          <Row label="Your balance">${userBalanceUsd}</Row>
          <Row label="After purchase">${(Number(userBalanceUsd) - Number(priceUsd)).toFixed(2)}</Row>
        </dl>

        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Published odds
          </div>
          <ul className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            {(Object.keys(publishedOddsPct) as (keyof typeof publishedOddsPct)[]).map((k) => (
              <li key={k} className="flex justify-between">
                <span>{k}</span>
                <span className="tabular-nums">{publishedOddsPct[k]}%</span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting || insufficient}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {submitting ? "Buying…" : insufficient ? "Not enough funds" : "Buy 1 Pack"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

function errorMessage(code: unknown): string {
  switch (code) {
    case "sold_out":
      return "This drop just sold out.";
    case "not_live":
      return "This drop isn't live right now.";
    case "insufficient_funds":
      return "Not enough funds. Add more and try again.";
    case "over_limit":
      return "You've reached the max packs for this drop.";
    case "not_found":
      return "Drop not found.";
    case "unauthorized":
      return "Please log in again.";
    default:
      return "Purchase failed. Try again.";
  }
}
