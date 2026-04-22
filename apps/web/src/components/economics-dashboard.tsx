"use client";

import { useCallback, useEffect, useState } from "react";

type WindowKey = "today" | "7d" | "30d" | "all";

interface Snapshot {
  window: WindowKey;
  since: string | null;
  generatedAt: string;
  packs: {
    totalRevenue: string;
    totalEvRealised: string;
    totalMarginAbs: string;
    totalMarginPct: string;
    perTier: Array<{
      tier: "STARTER" | "PREMIUM" | "ULTRA";
      count: number;
      revenue: string;
      evRealised: string;
      evTarget: string;
      marginAbs: string;
      marginPct: string;
      evRealisedVsTargetPct: string;
    }>;
  };
  trades: { count: number; gmv: string; feeRevenue: string };
  auctions: {
    count: number; gmv: string; feeRevenue: string; avgExtensions: string;
    totalSettled: number; cancelled: number; closedNoWinner: number;
  };
  platform: { totalRevenue: string; totalFeeRevenue: string; activeUsers: number };
  topUsers: Array<{ userId: string; email: string; totalSpend: string }>;
}

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All time" },
];

const TIER_TONE = {
  STARTER: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  PREMIUM: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  ULTRA: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

export function EconomicsDashboard() {
  const [win, setWin] = useState<WindowKey>("all");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [freshNonce, setFreshNonce] = useState(0);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setFreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("window", win);
    if (freshNonce > 0) params.set("fresh", "1");
    (async () => {
      try {
        const res = await fetch(`/api/admin/economics?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = (await res.json()) as Snapshot;
        if (cancelled) return;
        setData(snap);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [win, freshNonce]);

  const downloadCsv = () => {
    const href = `/api/admin/economics?window=${win}&format=csv`;
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (loading && !data) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 text-xs dark:border-zinc-700">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWin(w.key)}
              className={`h-8 px-3 font-medium ${win === w.key ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex h-8 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex h-8 items-center rounded-lg border border-zinc-300 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          ⬇ CSV
        </button>
        <span className="ml-auto text-xs text-zinc-500">
          as of {new Date(data.generatedAt).toISOString().slice(0, 19).replace("T", " ")} UTC
        </span>
      </div>

      {/* Platform summary */}
      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-4">
        <Tile label="Platform revenue" value={`$${Number(data.platform.totalRevenue).toFixed(2)}`} />
        <Tile label="Fee revenue" value={`$${Number(data.platform.totalFeeRevenue).toFixed(2)}`} />
        <Tile label="Pack margin" value={`$${Number(data.packs.totalMarginAbs).toFixed(2)} (${data.packs.totalMarginPct}%)`} />
        <Tile label="Active users" value={String(data.platform.activeUsers)} />
      </section>

      {/* Packs breakdown */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold">Pack sales by tier</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="pb-2">Tier</th>
                <th className="pb-2 text-right">Count</th>
                <th className="pb-2 text-right">Revenue</th>
                <th className="pb-2 text-right">EV realised</th>
                <th className="pb-2 text-right">EV target</th>
                <th className="pb-2 text-right">Margin</th>
                <th className="pb-2 text-right">EV hit</th>
              </tr>
            </thead>
            <tbody>
              {data.packs.perTier.map((t) => (
                <tr key={t.tier} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${TIER_TONE[t.tier]}`}>
                      {t.tier}
                    </span>
                  </td>
                  <td className="py-2 text-right">{t.count}</td>
                  <td className="py-2 text-right">${Number(t.revenue).toFixed(2)}</td>
                  <td className="py-2 text-right">${Number(t.evRealised).toFixed(2)}</td>
                  <td className="py-2 text-right">${Number(t.evTarget).toFixed(2)}</td>
                  <td className={`py-2 text-right ${Number(t.marginAbs) > 0 ? "text-emerald-600" : Number(t.marginAbs) < 0 ? "text-red-600" : ""}`}>
                    ${Number(t.marginAbs).toFixed(2)} ({t.marginPct}%)
                  </td>
                  <td className="py-2 text-right">{t.evRealisedVsTargetPct}%</td>
                </tr>
              ))}
              <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-800">
                <td className="py-2">Total</td>
                <td className="py-2 text-right">{data.packs.perTier.reduce((a, t) => a + t.count, 0)}</td>
                <td className="py-2 text-right">${Number(data.packs.totalRevenue).toFixed(2)}</td>
                <td className="py-2 text-right">${Number(data.packs.totalEvRealised).toFixed(2)}</td>
                <td className="py-2 text-right">—</td>
                <td className={`py-2 text-right ${Number(data.packs.totalMarginAbs) > 0 ? "text-emerald-600" : Number(data.packs.totalMarginAbs) < 0 ? "text-red-600" : ""}`}>
                  ${Number(data.packs.totalMarginAbs).toFixed(2)} ({data.packs.totalMarginPct}%)
                </td>
                <td className="py-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Trades + auctions side by side */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold">Marketplace</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
            <dt className="text-zinc-500">Trades</dt>
            <dd className="text-right">{data.trades.count}</dd>
            <dt className="text-zinc-500">GMV</dt>
            <dd className="text-right">${Number(data.trades.gmv).toFixed(2)}</dd>
            <dt className="text-zinc-500">Fee revenue (5%)</dt>
            <dd className="text-right font-semibold">${Number(data.trades.feeRevenue).toFixed(2)}</dd>
          </dl>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold">Auctions</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
            <dt className="text-zinc-500">Settled (winner)</dt>
            <dd className="text-right">{data.auctions.totalSettled}</dd>
            <dt className="text-zinc-500">Closed no-bid</dt>
            <dd className="text-right">{data.auctions.closedNoWinner}</dd>
            <dt className="text-zinc-500">Cancelled</dt>
            <dd className="text-right">{data.auctions.cancelled}</dd>
            <dt className="text-zinc-500">GMV</dt>
            <dd className="text-right">${Number(data.auctions.gmv).toFixed(2)}</dd>
            <dt className="text-zinc-500">Fee revenue (10%)</dt>
            <dd className="text-right font-semibold">${Number(data.auctions.feeRevenue).toFixed(2)}</dd>
            <dt className="text-zinc-500">Avg extensions</dt>
            <dd className="text-right">{data.auctions.avgExtensions}</dd>
          </dl>
        </div>
      </section>

      {/* Top users */}
      {data.topUsers.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold">Top users by spend</h2>
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {data.topUsers.map((u, i) => (
              <li key={u.userId} className="flex items-center justify-between rounded px-2 py-1">
                <span className="flex items-center gap-2">
                  <span className="text-zinc-500">{i + 1}.</span>
                  <span>{u.email}</span>
                </span>
                <span className="font-semibold">${Number(u.totalSpend).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
