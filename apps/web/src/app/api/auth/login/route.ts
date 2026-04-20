import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  signAccessToken,
} from "@/lib/jwt";

const loginSchema = z.object({
  email: z.string().email().max(200).toLowerCase(),
  password: z.string().min(1).max(200),
});

const FAILURE_DELAY_MS = 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, isAdmin: true, passwordHash: true, balance: true, balanceHeld: true },
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = signAccessToken({
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
  });

  const store = await cookies();
  store.set({
    name: ACCESS_TOKEN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
    path: "/",
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      balance: user.balance.toString(),
      balanceHeld: user.balanceHeld.toString(),
      isAdmin: user.isAdmin,
    },
  });
}
