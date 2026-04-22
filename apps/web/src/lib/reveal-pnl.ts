import { Decimal, ZERO } from "@/lib/money";

// Pack reveal P&L — two views on the same 5-card pack:
//   atPull  = Σ(pricedCaptured) − tierPrice   (locked at purchase)
//   current = Σ(basePrice)      − tierPrice   (live as of this read)
// Phase 2 reads basePrice statically; Phase 3 will start moving it.

export interface RevealPnlCard {
  pricedCaptured: Decimal | string;
  basePrice: Decimal | string;
}

export interface RevealPnl {
  spent: Decimal;
  atPullValue: Decimal;
  currentValue: Decimal;
  atPullDelta: Decimal;
  currentDelta: Decimal;
  atPullPct: Decimal;
  currentPct: Decimal;
}

export function computeRevealPnl(
  tierPrice: Decimal | string | number,
  cards: readonly RevealPnlCard[],
): RevealPnl {
  const spent = new Decimal(tierPrice);
  const atPullValue = cards.reduce<Decimal>(
    (acc, c) => acc.add(new Decimal(c.pricedCaptured)),
    ZERO,
  );
  const currentValue = cards.reduce<Decimal>(
    (acc, c) => acc.add(new Decimal(c.basePrice)),
    ZERO,
  );
  const atPullDelta = atPullValue.sub(spent);
  const currentDelta = currentValue.sub(spent);
  const atPullPct = spent.isZero() ? ZERO : atPullDelta.div(spent).mul(100);
  const currentPct = spent.isZero() ? ZERO : currentDelta.div(spent).mul(100);
  return { spent, atPullValue, currentValue, atPullDelta, currentDelta, atPullPct, currentPct };
}
