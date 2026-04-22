import { Prisma } from "@prisma/client";

// ─── Bid mechanics ─────────────────────────────────────────────────────────

// Minimum delta over the current high bid for the next valid bid.
// Rule: max(5% of current, $0.10), ceiled to the cent.
// Floor ensures the auction can't grind in sub-dollar increments forever.
export const BID_INCREMENT_PCT = new Prisma.Decimal("0.05");
export const BID_INCREMENT_FLOOR = new Prisma.Decimal("0.10");

export function minNextBid(currentHigh: Prisma.Decimal | string | number): string {
  const cur = new Prisma.Decimal(currentHigh);
  const pctRaw = cur.mul(BID_INCREMENT_PCT);
  const pct = ceilCents(pctRaw);
  const step = Prisma.Decimal.max(pct, BID_INCREMENT_FLOOR);
  return cur.add(step).toFixed(4);
}

function ceilCents(d: Prisma.Decimal): Prisma.Decimal {
  return d.mul(100).ceil().div(100);
}

// ─── Anti-snipe ────────────────────────────────────────────────────────────

export const ANTI_SNIPE_WINDOW_SEC = 30;
export const ANTI_SNIPE_EXTEND_SEC = 30;
export const ANTI_SNIPE_MAX_EXTENSIONS = 20;

// Given a bid arriving at `now` on an auction with current `closesAt` and
// prior `extensions`, return the new closesAt + new extensions count. If the
// bid is outside the window or cap is hit, returns the current values
// unchanged.
export function applyAntiSnipe(
  now: Date,
  closesAt: Date,
  extensions: number,
): { closesAt: Date; extensions: number } {
  const secToClose = Math.floor((closesAt.getTime() - now.getTime()) / 1000);
  if (secToClose > ANTI_SNIPE_WINDOW_SEC) {
    return { closesAt, extensions };
  }
  if (extensions >= ANTI_SNIPE_MAX_EXTENSIONS) {
    return { closesAt, extensions };
  }
  return {
    closesAt: new Date(closesAt.getTime() + ANTI_SNIPE_EXTEND_SEC * 1000),
    extensions: extensions + 1,
  };
}

// ─── Auction fee (10% ceil, seller eats rounding — same pattern as Phase 5) ─

export const AUCTION_FEE_RATE = new Prisma.Decimal("0.10");

export function computeAuctionFee(finalBid: Prisma.Decimal | string | number): {
  fee: string;
  sellerNet: string;
} {
  const ask = new Prisma.Decimal(finalBid);
  const rawFee = ask.mul(AUCTION_FEE_RATE);
  const fee = ceilCents(rawFee);
  const sellerNet = ask.sub(fee);
  return { fee: fee.toFixed(4), sellerNet: sellerNet.toFixed(4) };
}

// ─── Duration presets ──────────────────────────────────────────────────────

export const AUCTION_DURATION_OPTIONS: ReadonlyArray<{ key: string; seconds: number; label: string }> = [
  { key: "1h", seconds: 60 * 60, label: "1 hour" },
  { key: "6h", seconds: 6 * 60 * 60, label: "6 hours" },
  { key: "24h", seconds: 24 * 60 * 60, label: "24 hours" },
];

export function resolveDuration(key: unknown): number | null {
  if (typeof key !== "string") return null;
  const opt = AUCTION_DURATION_OPTIONS.find((o) => o.key === key);
  return opt?.seconds ?? null;
}
