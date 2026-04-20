import jwt from "jsonwebtoken";

export const ACCESS_TOKEN_COOKIE = "pv_access";
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60; // HLD ADR-10

export interface JwtPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
}

function getSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET is missing or too short (need ≥16 chars)");
  }
  return s;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("invalid token payload");
  }
  const { userId, email, isAdmin } = decoded as Partial<JwtPayload>;
  if (typeof userId !== "string" || typeof email !== "string" || typeof isAdmin !== "boolean") {
    throw new Error("malformed token payload");
  }
  return { userId, email, isAdmin };
}
