import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkLimitEdge } from "@/lib/ratelimit-edge";

// Global per-IP rate-limit floor — applies before route handlers run.
// Per-user limits (looser, see purchase route) live in the route layer
// because they need session context the middleware can't cheaply read.
//
// Uses Upstash REST under the hood so the limiter is Edge-runtime-safe.
// Fails OPEN if env vars or transport are unhealthy — the per-route Node
// limiters on the high-value paths (purchase, bid) are the hard floor.

const PER_IP_WINDOW_SEC = 60;
const PER_IP_MAX = 60;

const SKIP_PREFIX = ["/_next", "/api/auth", "/favicon", "/static"];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  for (const p of SKIP_PREFIX) if (pathname.startsWith(p)) return NextResponse.next();
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const ip = clientIp(req);
  const r = await checkLimitEdge(`rl:ip:${ip}`, {
    windowSec: PER_IP_WINDOW_SEC,
    max: PER_IP_MAX,
  });
  if (!r.allowed) {
    return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(r.retryAfterSec),
      },
    });
  }
  return NextResponse.next();
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const config = {
  matcher: ["/api/:path*"],
};
