import { Prisma } from "@prisma/client";

// Marketplace trade fee: 5% of ask. Fee is ceil-to-cent; seller eats the
// rounding so buyer pays the round number and platform never short-changes
// itself on cash flow.
//
// Returns 4-decimal strings so callers feed them straight into Prisma Decimal
// columns without another conversion.
export const TRADE_FEE_RATE = new Prisma.Decimal("0.05");

export function computeTradeFee(priceAsk: Prisma.Decimal | string | number): {
  fee: string;
  sellerNet: string;
} {
  const ask = new Prisma.Decimal(priceAsk);
  const rawFee = ask.mul(TRADE_FEE_RATE);
  const feeCents = rawFee.mul(100).ceil();
  const fee = feeCents.div(100);
  const sellerNet = ask.sub(fee);
  return { fee: fee.toFixed(4), sellerNet: sellerNet.toFixed(4) };
}
