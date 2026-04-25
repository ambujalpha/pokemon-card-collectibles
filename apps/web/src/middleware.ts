import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { checkLimit } from "@/lib/ratelimit";

// Global per-IP rate-limit floor — applies before route handlers run.
// Per-user limits (looser, see purchase route) live in the route layer
// because they need session context the middleware can't cheaply read.
// Looser per-user cap means office-NAT humans aren't blocked when one
// workspace mate bursts.

const PER_IP_WINDOW_SEC = 60;
const PER_IP_MAX = 60;

// Skip rate-limit on assets and auth (login storms shouldn't lock people
// out, and Next's own static path fetches would trip the limit fast).
const SKIP_PREFIX = ["/_next", "/api/auth", "/favicon", "/static"];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  for (const p of SKIP_PREFIX) if (pathname.startsWith(p)) return NextResponse.next();

  // Only rate-limit API calls — page navigations are cheap and humans expect
  // them to be snappy.
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const ip = clientIp(req);
  const r = await checkLimit(`rl:ip:${ip}`, {
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
