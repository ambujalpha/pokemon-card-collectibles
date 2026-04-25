"use client";

import { useEffect, useState } from "react";

import { EconomicsDashboard } from "./economics-dashboard";

type Tab = "revenue" | "fraud" | "health" | "fairness" | "users";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "revenue", label: "Revenue" },
  { key: "fraud", label: "Fraud" },
  { key: "health", label: "Economic Health" },
  { key: "fairness", label: "Fairness" },
  { key: "users", label: "Users" },
];

export function EconomicsDashboardTabs() {
  const [tab, setTab] = useState<Tab>("revenue");

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium " +
                (active
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "revenue" && <EconomicsDashboard />}
      {tab === "fraud" && <FraudTab />}
      {tab === "health" && <HealthTab />}
      {tab === "fairness" && <FairnessTab />}
      {tab === "users" && <UsersTab />}
    </div>
  );
}

// ─── Fraud ──────────────────────────────────────────────────────────────────

interface FraudData {
  flaggedAccounts: number;
  riskUpdated24h: number;
  topRisk: Array<{
    userId: string; email: string; score: number;
    flagged: boolean; lastUpdated: string;
  }>;
  accountLinkClusters: Array<{ ip: string; userAgentHash: string; users: number }>;
}

function FraudTab() {
  const [d, setD] = useState<FraudData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void load("/api/admin/economics/fraud", setD, setErr); }, []);
  if (err) return <Err msg={err} />;
  if (!d) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Flagged accounts" value={d.flaggedAccounts.toString()} />
        <Stat label="Risk events (24h)" value={d.riskUpdated24h.toString()} />
      </div>
      <Section title="Top risk scores">
        <Table head={["Email", "Score", "Flagged", "Last updated"]}
          rows={d.topRisk.map((r) => [r.email, r.score, r.flagged ? "yes" : "no", r.lastUpdated])} />
      </Section>
      <Section title="Account-link clusters (≥3 users / 24h)">
        <Table head={["IP", "UA hash", "Users"]}
          rows={d.accountLinkClusters.map((c) => [c.ip, c.userAgentHash, c.users])} />
      </Section>
    </div>
  );
}

// ─── Economic Health ───────────────────────────────────────────────────────

interface HealthData {
  perTier: Array<{
    tier: "STARTER" | "PREMIUM" | "ULTRA";
    packsCount: number;
    realisedMargin: number;
    targetMargin: number;
    driftPp: number;
    activeVersion: {
      id: string; realisedMargin: string; constraintBinding: string | null;
      createdAt: string; ageMin: number;
    } | null;
    rebalanceSuggested: boolean;
  }>;
}

function HealthTab() {
  const [d, setD] = useState<HealthData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<unknown>(null);

  function reload() { void load("/api/admin/economics/health", setD, setErr); }
  useEffect(reload, []);

  async function rebalance(tier?: string) {
    setBusy(true); setMsg(null);
    try {
      const url = tier ? `/api/admin/economics/rebalance?tier=${tier}` : "/api/admin/economics/rebalance";
      const r = await fetch(url, { method: "POST" });
      const j = await r.json();
      setMsg(r.ok ? `Rebalanced ${tier ?? "all tiers"}.` : `Failed: ${JSON.stringify(j)}`);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function simulate(tier: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/economics/simulate?tier=${tier}&n=10000`, { method: "POST" });
      const j = await r.json();
      setSimResult(j);
    } finally { setBusy(false); }
  }

  if (err) return <Err msg={err} />;
  if (!d) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => rebalance()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900">
          Rebalance all tiers
        </button>
        {["STARTER", "PREMIUM", "ULTRA"].map((t) => (
          <button key={t} disabled={busy} onClick={() => rebalance(t)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            Rebalance {t}
          </button>
        ))}
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      <Section title="Per-tier health (last 7d)">
        <Table head={["Tier", "Packs", "Realised", "Target", "Drift", "Active version", "Constraint", "Age (min)", "Rebalance?", ""]}
          rows={d.perTier.map((t) => [
            t.tier, t.packsCount,
            (t.realisedMargin * 100).toFixed(2) + "%",
            (t.targetMargin * 100).toFixed(0) + "%",
            (t.driftPp * 100).toFixed(2) + "pp",
            t.activeVersion?.id.slice(0, 8) ?? "—",
            t.activeVersion?.constraintBinding ?? "—",
            t.activeVersion?.ageMin ?? "—",
            t.rebalanceSuggested ? "yes" : "no",
            <button key={t.tier} disabled={busy} onClick={() => simulate(t.tier)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
              Simulate
            </button>,
          ])} />
      </Section>
      {simResult !== null && (
        <Section title="Simulate result">
          <pre className="overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
            {JSON.stringify(simResult, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

// ─── Fairness ───────────────────────────────────────────────────────────────

interface FairnessAuditData {
  window: string;
  perTier: Array<{
    tier: "STARTER" | "PREMIUM" | "ULTRA";
    chi2: number;
    df: number;
    pValue: number;
    revealedPacks: number;
  }>;
}

function FairnessTab() {
  const [d, setD] = useState<FairnessAuditData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void load("/api/fairness/audit?window=30d", setD, setErr); }, []);
  if (err) return <Err msg={err} />;
  if (!d) return <Loading />;
  return (
    <Section title={`Fairness audit (${d.window})`}>
      <Table head={["Tier", "Revealed packs", "χ²", "df", "p-value", "Status"]}
        rows={d.perTier.map((t) => [
          t.tier, t.revealedPacks, t.chi2.toFixed(3), t.df,
          t.pValue.toFixed(4),
          t.pValue > 0.05 ? "🟢 ok" : t.pValue > 0.01 ? "🟡 watch" : "🔴 investigate",
        ])} />
    </Section>
  );
}

// ─── Users ─────────────────────────────────────────────────────────────────

interface UsersData {
  totals: { total: number; active24h: number; active7d: number };
  auctionParticipation7d: { uniqueBidders: number; uniqueSellers: number };
  dropEngagement7d: { uniqueBuyers: number; pctOfActive: number };
  retention7d: { cohort: number; retained: number; pct: number };
}

function UsersTab() {
  const [d, setD] = useState<UsersData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void load("/api/admin/economics/users", setD, setErr); }, []);
  if (err) return <Err msg={err} />;
  if (!d) return <Loading />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total users" value={d.totals.total} />
      <Stat label="Active 24h" value={d.totals.active24h} />
      <Stat label="Active 7d" value={d.totals.active7d} />
      <Stat label="Drop buyers 7d" value={`${d.dropEngagement7d.uniqueBuyers} (${d.dropEngagement7d.pctOfActive.toFixed(1)}%)`} />
      <Stat label="Auction bidders 7d" value={d.auctionParticipation7d.uniqueBidders} />
      <Stat label="Auction sellers 7d" value={d.auctionParticipation7d.uniqueSellers} />
      <Stat label="7d retention cohort" value={d.retention7d.cohort} />
      <Stat label="7d retained" value={`${d.retention7d.retained} (${d.retention7d.pct.toFixed(1)}%)`} />
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

function Loading() { return <p className="text-sm text-zinc-500">Loading…</p>; }
function Err({ msg }: { msg: string }) {
  return <p className="text-sm text-rose-600 dark:text-rose-400">Error: {msg}</p>;
}
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}
function Table({ head, rows }: { head: (string | number)[]; rows: (string | number | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="min-w-full text-sm tabular-nums">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="px-3 py-3 text-zinc-500">No rows.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
              {r.map((c, j) => <td key={j} className="px-3 py-2">{c as React.ReactNode}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function load<T>(url: string, setD: (t: T) => void, setErr: (e: string | null) => void) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setD((await r.json()) as T);
    setErr(null);
  } catch (e) {
    setErr(e instanceof Error ? e.message : "Load failed");
  }
}
