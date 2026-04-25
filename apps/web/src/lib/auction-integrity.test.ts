import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  isExcessiveOverbid,
  isInSealedWindow,
  MAX_OVERBID_FACTOR,
  redactSealedFields,
  SEALED_PHASE_SEC,
} from "./auction-integrity";

describe("isExcessiveOverbid", () => {
  it("returns false when there is no current high", () => {
    expect(isExcessiveOverbid(null, new Prisma.Decimal("100"))).toBe(false);
    expect(isExcessiveOverbid(undefined, new Prisma.Decimal("100"))).toBe(false);
  });

  it("rejects a bid more than 5× the current high", () => {
    const cur = "10.00";
    expect(isExcessiveOverbid(cur, new Prisma.Decimal("50.01"))).toBe(true);
    expect(isExcessiveOverbid(cur, new Prisma.Decimal("500"))).toBe(true);
  });

  it("admits a bid at exactly 5× the current high", () => {
    const cur = "10.00";
    expect(isExcessiveOverbid(cur, new Prisma.Decimal("50.00"))).toBe(false);
  });

  it("respects MAX_OVERBID_FACTOR constant", () => {
    expect(MAX_OVERBID_FACTOR).toBe(5);
  });
});

describe("isInSealedWindow", () => {
  it("returns true within the last SEALED_PHASE_SEC seconds", () => {
    const closesAt = new Date(2026, 0, 1, 12, 0, 0);
    const now = new Date(closesAt.getTime() - 30_000);
    expect(isInSealedWindow(now, closesAt)).toBe(true);
  });

  it("returns false outside the window", () => {
    const closesAt = new Date(2026, 0, 1, 12, 0, 0);
    const before = new Date(closesAt.getTime() - (SEALED_PHASE_SEC + 5) * 1000);
    expect(isInSealedWindow(before, closesAt)).toBe(false);
  });

  it("returns false after auction has closed", () => {
    const closesAt = new Date(2026, 0, 1, 12, 0, 0);
    const after = new Date(closesAt.getTime() + 1);
    expect(isInSealedWindow(after, closesAt)).toBe(false);
  });
});

describe("redactSealedFields", () => {
  const closesAt = new Date(2026, 0, 1, 12, 0, 0);

  it("redacts current_bid + current_bidder_id during sealed window for LIVE", () => {
    const now = new Date(closesAt.getTime() - 10_000);
    const v = { currentBid: "42", currentBidderId: "u1", bids: [{ x: 1 }], status: "LIVE" };
    const out = redactSealedFields(v, now, closesAt, "LIVE");
    expect(out.currentBid).toBe(null);
    expect(out.currentBidderId).toBe(null);
    expect(out.bids).toEqual([]);
  });

  it("does not redact CLOSED auctions", () => {
    const now = new Date(closesAt.getTime() - 10_000);
    const v = { currentBid: "42", currentBidderId: "u1", bids: [], status: "CLOSED" };
    const out = redactSealedFields(v, now, closesAt, "CLOSED");
    expect(out.currentBid).toBe("42");
  });

  it("does not redact when outside the sealed window", () => {
    const now = new Date(closesAt.getTime() - 10 * 60 * 1000);
    const v = { currentBid: "42", currentBidderId: "u1", bids: [], status: "LIVE" };
    const out = redactSealedFields(v, now, closesAt, "LIVE");
    expect(out.currentBid).toBe("42");
  });
});
