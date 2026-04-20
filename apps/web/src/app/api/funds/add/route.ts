import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Decimal, MoneyParseError, parseMoney } from "@/lib/money";

const addFundsSchema = z.object({
  amount: z.union([z.string(), z.number()]),
});

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 5000;

export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = addFundsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  let amount: Decimal;
  try {
    amount = parseMoney(parsed.data.amount);
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return NextResponse.json({ error: "invalid_amount", detail: err.message }, { status: 400 });
    }
    throw err;
  }

  const delay = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  await new Promise((r) => setTimeout(r, delay));

  const newBalance = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: session.userId },
      data: { balance: { increment: amount.toString() } },
      select: { balance: true },
    });
    await tx.ledger.create({
      data: {
        userId: session.userId,
        delta: amount.toString(),
        reason: "FUND_DEPOSIT",
        refType: "funding",
        balanceAfter: updated.balance,
      },
    });
    return updated.balance;
  });

  return NextResponse.json({ balance: newBalance.toString() });
}
