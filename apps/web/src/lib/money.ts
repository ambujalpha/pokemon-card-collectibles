import Decimal from "decimal.js";

// Every money value uses this Decimal config across the app.
// ROUND_HALF_UP is the default; fees apply ceil-to-cent at the call site.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export const ZERO = new Decimal(0);

const MAX_ADD_FUNDS = new Decimal(1_000_000);

export function parseMoney(value: unknown): Decimal {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new MoneyParseError("amount must be a string or number");
  }
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new MoneyParseError("amount is not a valid number");
  }
  if (!d.isFinite()) {
    throw new MoneyParseError("amount is not finite");
  }
  if (d.isNegative() || d.isZero()) {
    throw new MoneyParseError("amount must be positive");
  }
  if (d.greaterThan(MAX_ADD_FUNDS)) {
    throw new MoneyParseError("amount exceeds per-call cap");
  }
  return d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function formatMoney(value: Decimal | string | number): string {
  return new Decimal(value).toFixed(2);
}

export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}
