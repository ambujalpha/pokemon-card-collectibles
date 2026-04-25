import { Prisma } from "@prisma/client";

import { redis } from "@/lib/redis";

// Phase 10 hardening helpers. See docs/qa/phase-10-auction-integrity.md.

// ─── Bid increment cap (5×) ────────────────────────────────────────────────
//
// Reject bids more than 5× the current high — almost always a fat-finger
// (typed $1500 instead of $15.00). Returns true if the bid is acceptable
// for-amount; false otherwise. Doesn't replace minNextBid; runs alongside.

export const MAX_OVERBID_FACTOR = 5;

export function isExcessiveOverbid(
  currentHigh: Prisma.Decimal | string | number | null | undefined,
  proposed: Prisma.Decimal,
): boolean {
  if (currentHigh === null || currentHigh === undefined) return false;
  const cur = new Prisma.Decimal(currentHigh);
  if (cur.isZero()) return false;
  return proposed.gt(cur.mul(MAX_OVERBID_FACTOR));
}

// ─── Min interval between bids from same user ──────────────────────────────
//
// 2 seconds. Atomic SET NX EX in Redis: returns true on the first call in a
// window, false on subsequent calls until TTL expires. Survives across
// process restarts via Redis.

export const MIN_BID_INTERVAL_SEC = 2;

export async function tryClaimBidSlot(
  userId: string,
  auctionId: string,
): Promise<boolean> {
  const key = `bid:lastAt:${userId}:${auctionId}`;
  const result = await redis.set(key, "1", "EX", MIN_BID_INTERVAL_SEC, "NX");
  return result === "OK";
}

// ─── Sealed-bid final phase ────────────────────────────────────────────────

export const SEALED_PHASE_SEC = 60;

export function isInSealedWindow(now: Date, closesAt: Date): boolean {
  const msToClose = closesAt.getTime() - now.getTime();
  return msToClose > 0 && msToClose <= SEALED_PHASE_SEC * 1000;
}

// Redact a public auction read while the sealed phase is in effect. We
// scrub the leaderboard fields while preserving everything else (status,
// closesAt, extensions count) so the countdown still ticks.
export interface SealableAuctionView<T> {
  currentBid?: T;
  currentBidderId?: T;
  bids?: unknown;
}

export function redactSealedFields<T extends SealableAuctionView<unknown>>(
  view: T,
  now: Date,
  closesAt: Date,
  status: string,
): T {
  if (status !== "LIVE") return view;
  if (!isInSealedWindow(now, closesAt)) return view;
  return { ...view, currentBid: null, currentBidderId: null, bids: [] };
}
