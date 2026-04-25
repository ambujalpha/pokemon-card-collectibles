import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";

// Behavioural risk signals for the purchase + reveal paths.
// See docs/qa/phase-9-anti-bot.md §3.

export const SIGNAL_WEIGHTS = {
  fastReveal: 30,
  rapidPurchase: 25,
  multiAccount: 40,
  freshSession: 20,
} as const;

export const FLAG_THRESHOLD = 100;
export const RAPID_PURCHASE_MS = 200;
export const FAST_REVEAL_MS = 500;
export const FRESH_SESSION_MS = 30_000;
export const MULTI_ACCOUNT_THRESHOLD = 3;

export type SignalKey = keyof typeof SIGNAL_WEIGHTS;

export function hashUserAgent(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  return createHash("sha256").update(ua).digest("hex").slice(0, 16);
}

interface SignalContext {
  userId: string;
  ip: string;
  userAgent: string | null | undefined;
  /** Wall clock of the action (ms since epoch). Defaults to now. */
  at?: number;
  /** Session creation time, ms since epoch. Optional. */
  sessionStartedAt?: number;
  /** Time of the user's previous purchase, ms since epoch. Optional. */
  previousPurchaseAt?: number;
}

interface PurchaseSignals {
  triggered: SignalKey[];
  scoreDelta: number;
}

export async function evaluatePurchaseSignals(ctx: SignalContext): Promise<PurchaseSignals> {
  const at = ctx.at ?? Date.now();
  const triggered: SignalKey[] = [];

  if (ctx.previousPurchaseAt !== undefined && at - ctx.previousPurchaseAt < RAPID_PURCHASE_MS) {
    triggered.push("rapidPurchase");
  }
  if (ctx.sessionStartedAt !== undefined && at - ctx.sessionStartedAt < FRESH_SESSION_MS) {
    triggered.push("freshSession");
  }

  // Multi-account: ≥ N distinct user_ids share this (ip, ua_hash) recently.
  const uaHash = hashUserAgent(ctx.userAgent);
  const sharedUsers = await countSharedUsers(ctx.ip, uaHash);
  if (sharedUsers >= MULTI_ACCOUNT_THRESHOLD) {
    triggered.push("multiAccount");
  }

  await recordAccountLink(ctx.userId, ctx.ip, uaHash, at);

  const scoreDelta = triggered.reduce((acc, k) => acc + SIGNAL_WEIGHTS[k], 0);
  if (scoreDelta > 0) {
    await applyRiskDelta(ctx.userId, scoreDelta, triggered);
  }
  return { triggered, scoreDelta };
}

export async function evaluateRevealSignals(opts: {
  userId: string;
  purchasedAt: Date;
  revealedAt?: Date;
}): Promise<PurchaseSignals> {
  const at = (opts.revealedAt ?? new Date()).getTime();
  const triggered: SignalKey[] = [];
  if (at - opts.purchasedAt.getTime() < FAST_REVEAL_MS) {
    triggered.push("fastReveal");
  }
  const scoreDelta = triggered.reduce((acc, k) => acc + SIGNAL_WEIGHTS[k], 0);
  if (scoreDelta > 0) {
    await applyRiskDelta(opts.userId, scoreDelta, triggered);
  }
  return { triggered, scoreDelta };
}

async function countSharedUsers(ip: string, uaHash: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(DISTINCT user_id)::bigint AS cnt
    FROM account_links
    WHERE ip = ${ip} AND user_agent_hash = ${uaHash}
      AND last_seen >= NOW() - INTERVAL '24 hours'
  `;
  return Number(rows[0]?.cnt ?? BigInt(0));
}

async function recordAccountLink(
  userId: string,
  ip: string,
  uaHash: string,
  at: number,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO account_links (id, user_id, ip, user_agent_hash, seen_count, first_seen, last_seen)
    VALUES (gen_random_uuid(), ${userId}::uuid, ${ip}, ${uaHash}, 1, to_timestamp(${at} / 1000.0), to_timestamp(${at} / 1000.0))
    ON CONFLICT (user_id, ip, user_agent_hash) DO UPDATE
    SET seen_count = account_links.seen_count + 1,
        last_seen = EXCLUDED.last_seen
  `;
}

async function applyRiskDelta(
  userId: string,
  delta: number,
  triggered: SignalKey[],
): Promise<void> {
  const merge: Record<string, number> = {};
  for (const k of triggered) merge[k] = (merge[k] ?? 0) + 1;

  await prisma.$executeRaw`
    INSERT INTO user_risk (user_id, score, flagged, signals_json, last_updated)
    VALUES (${userId}::uuid, ${delta}, ${delta >= FLAG_THRESHOLD}, ${JSON.stringify(merge)}::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET score = user_risk.score + ${delta},
        flagged = (user_risk.score + ${delta}) >= ${FLAG_THRESHOLD},
        signals_json = COALESCE(user_risk.signals_json, '{}'::jsonb) || ${JSON.stringify(merge)}::jsonb,
        last_updated = NOW()
  `;
}
