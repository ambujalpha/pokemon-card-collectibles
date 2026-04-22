// Auction close worker.
//
// Runs an interval in the ws process. Every TICK_MS it POSTs to the web
// service's /api/internal/auctions/settle-due endpoint, which settles any
// LIVE auctions whose closes_at has passed (see HLD ADR-9 — per-second
// global tick). The endpoint uses SELECT FOR UPDATE SKIP LOCKED so
// overlapping ticks never double-settle.
//
// Keeping all DB writes in the web process means Prisma + migrations live in
// one place; the ws service only needs HTTP access to web.
//
// Env:
//   WEB_INTERNAL_URL   — base URL of the web service (e.g. http://localhost:3000)
//   WS_INTERNAL_SECRET — shared secret, mirrors the same var on the web side

const TICK_MS = 1000;
const SETTLE_PATH = "/api/internal/auctions/settle-due";

let timer: NodeJS.Timeout | null = null;
let inflight = false;

export function startCloseWorker(secret: string): void {
  const base = process.env.WEB_INTERNAL_URL;
  if (!base) {
    console.warn("close-worker: WEB_INTERNAL_URL not set — auction settlement disabled");
    return;
  }
  const url = `${base.replace(/\/$/, "")}${SETTLE_PATH}`;
  console.log(`close-worker: polling ${url} every ${TICK_MS}ms`);

  timer = setInterval(() => {
    void tick(url, secret);
  }, TICK_MS);
  timer.unref?.();
}

async function tick(url: string, secret: string): Promise<void> {
  // Skip if a prior tick is still running (slow DB, long settlement batch).
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-Internal-Secret": secret, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.warn(`close-worker: settle-due returned ${res.status}`);
      return;
    }
    const data = (await res.json()) as { settled?: number; ids?: string[] };
    if (data.settled && data.settled > 0) {
      console.log(`close-worker: settled ${data.settled} auction(s): ${data.ids?.join(", ") ?? ""}`);
    }
  } catch (err) {
    // Network errors are expected at startup if web hasn't booted yet.
    if (err instanceof Error && err.name !== "AbortError") {
      console.warn("close-worker: tick failed:", err.message);
    }
  } finally {
    inflight = false;
  }
}
