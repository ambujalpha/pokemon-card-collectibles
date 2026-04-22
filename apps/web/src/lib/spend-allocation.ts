import { Prisma } from "@prisma/client";

// Allocate a pack's tier price across its cards proportionally to each card's
// pricedCaptured. All outputs are 4-decimal Decimal strings. The last card
// absorbs rounding residual so the sum is *exactly* `tierPrice`.
//
// Used by:
//   - reveal route (populates user_cards.acquiredPrice on new pulls)
//   - phase4_5 migration backfill (approximated in SQL — this TS version is
//     the authoritative source for new data)
//
// Edge case: if the pricedCaptured vector sums to 0 (all zero-fallback cards),
// distribute the tier price equally.
export function allocateSpend(
  pricedCaptured: ReadonlyArray<Prisma.Decimal | string | number>,
  tierPrice: Prisma.Decimal | string | number,
): string[] {
  const n = pricedCaptured.length;
  if (n === 0) return [];
  const tier = new Prisma.Decimal(tierPrice);
  const captured = pricedCaptured.map((v) => new Prisma.Decimal(v));
  const total = captured.reduce((a, b) => a.add(b), new Prisma.Decimal(0));

  if (total.isZero()) {
    const each = tier.div(n);
    const rounded = Array.from({ length: n - 1 }, () => each.toDecimalPlaces(4).toFixed(4));
    const sumSoFar = rounded.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
    rounded.push(tier.sub(sumSoFar).toFixed(4));
    return rounded;
  }

  const out: string[] = [];
  let runningSum = new Prisma.Decimal(0);
  for (let i = 0; i < n - 1; i++) {
    const share = captured[i].div(total).mul(tier).toDecimalPlaces(4);
    out.push(share.toFixed(4));
    runningSum = runningSum.add(share);
  }
  out.push(tier.sub(runningSum).toFixed(4));
  return out;
}
