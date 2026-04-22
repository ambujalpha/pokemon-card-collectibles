"use client";

import { useState } from "react";

const DEMO_JITTER = 0.05;

type Status =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; changedCount: number; totalCards: number; staleCount: number; refreshedAt: string }
  | { kind: "error"; message: string };

export function AdminRefreshButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Demo seam toggle. Default ON so the button "just works" during the Loom —
  // pokemontcg.io updates daily, so a real refresh likely shows zero deltas.
  // Toggle OFF to call upstream cleanly with no synthetic drift.
  const [demoJitter, setDemoJitter] = useState(true);

  const onClick = async () => {
    if (status.kind === "running") return;
    setStatus({ kind: "running" });
    try {
      const res = await fetch("/api/admin/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demoJitter ? { jitter: DEMO_JITTER } : {}),
      });
      if (res.status === 207) {
        const data = await res.json();
        setStatus({
          kind: "ok",
          changedCount: data.changedCount,
          totalCards: data.totalCards,
          staleCount: data.staleCount,
          refreshedAt: data.refreshedAt,
        });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({ kind: "error", message: mapError(res.status, body.error) });
        return;
      }
      const data = await res.json();
      setStatus({
        kind: "ok",
        changedCount: data.changedCount,
        totalCards: data.totalCards,
        staleCount: data.staleCount,
        refreshedAt: data.refreshedAt,
      });
    } catch {
      setStatus({ kind: "error", message: "Network error — try again." });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={status.kind === "running"}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40"
        title="Admin: re-fetch prices from pokemontcg.io"
      >
        {status.kind === "running" ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
            Refreshing…
          </>
        ) : (
          <>↻ Refresh prices</>
        )}
      </button>
      <label
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        title={`Apply ±${(DEMO_JITTER * 100).toFixed(0)}% random drift to fetched prices for demo visibility. pokemontcg.io changes daily; real refreshes often show zero deltas.`}
      >
        <input
          type="checkbox"
          checked={demoJitter}
          onChange={(e) => setDemoJitter(e.target.checked)}
          className="h-3 w-3 cursor-pointer accent-amber-600"
        />
        demo
      </label>
      {status.kind === "ok" ? (
        <Toast
          tone={status.staleCount > 0 ? "warn" : "ok"}
          text={
            status.staleCount > 0
              ? `${status.changedCount} changed · ${status.staleCount} stale (upstream partial)`
              : `${status.changedCount} of ${status.totalCards} changed`
          }
        />
      ) : null}
      {status.kind === "error" ? <Toast tone="error" text={status.message} /> : null}
    </div>
  );
}

function Toast({ tone, text }: { tone: "ok" | "warn" | "error"; text: string }) {
  const cls =
    tone === "ok"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-red-700 dark:text-red-400";
  return <span className={`text-[11px] tabular-nums ${cls}`}>{text}</span>;
}

function mapError(status: number, code?: string): string {
  if (status === 401) return "Sign in required.";
  if (status === 403) return "Admin only.";
  if (status === 429) return "Slow down — wait a few seconds.";
  if (status === 409 && code === "already_running") return "Already refreshing.";
  if (status === 502) return "Upstream unreachable — prices unchanged.";
  return "Refresh failed.";
}
