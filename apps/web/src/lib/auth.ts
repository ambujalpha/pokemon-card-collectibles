import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type JwtPayload } from "./jwt";

export async function getCurrentUser(): Promise<JwtPayload | null> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

export async function requireCurrentUser(): Promise<JwtPayload> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}
