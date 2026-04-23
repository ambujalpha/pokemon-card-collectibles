# apps/web/src/app/api/admin/prices

Admin-gated price refresh endpoint. The single moving part of the live-pricing surface.

## Files

- `refresh/route.ts` — `POST /api/admin/prices/refresh`. Runs the orchestration in `lib/pricing.ts`, then broadcasts `prices_refreshed` on the WS `prices` room.

## Auth & gating

Requires a valid JWT cookie + `users.is_admin = true`. Non-admin returns 403; unauthenticated returns 401.

## Request shape

```http
POST /api/admin/prices/refresh
Content-Type: application/json

{ "jitter": 0.05 }   // optional, [0, 0.2] — demo seam
```

Empty body / no `Content-Type` is also accepted. `jitter` defaults to 0.

## Response shapes

```jsonc
// 200 — full success (all sets fetched cleanly)
{
  "refreshedAt": "2026-04-22T11:30:14.123Z",
  "totalCards": 200,
  "changedCount": 5,
  "staleCount": 0,
  "changes": [{ "cardId": "...", "from": "1.2300", "to": "1.4500" }, ...],
  "upstreamOk": true
}

// 207 — partial success (some sets failed; affected cards marked stale)
{ ...same shape, "staleCount": 23, "upstreamOk": false }

// 409 — another refresh in flight on this process
{ "error": "already_running" }

// 429 — soft rate limit; called within 5s of previous
{ "error": "too_soon", "retryAfterMs": 3120 }
// + header: Retry-After: 4

// 502 — pokemontcg.io fully unreachable; DB untouched
{ "error": "upstream_error", "message": "pokemontcg.io returned 503" }
```

## Concurrency model

Single-instance web. Two process-local guards:

1. **Mutex.** `runningRefresh: Promise<RefreshResult> | null` — second call while the first runs returns 409 `already_running`.
2. **Soft rate limit.** `lastRefreshAt: number` — calls within 5s of the previous return 429 `too_soon` with a `Retry-After` header.

Both guards are intentionally process-local. Multi-instance production deploy would require a Redis SETNX lock — a known limitation for scaling.

## Side effects

In one Prisma transaction (`ReadCommitted`, 30s timeout):

1. Per-card UPDATE of `Card.basePrice + lastPricedAt + staleSince` (clear stale on success, set on per-set fetch failure).
2. Batch INSERT into `price_snapshots` — one row per card whose price was actually fetched.

After commit:

3. Redis cache invalidation: `SCAN price:* + UNLINK` in batches. Best-effort; failure logged but does not roll back the DB write.
4. WS broadcast `prices_refreshed` to room `prices` via `emitToRoom`. Fire-and-forget with 1s timeout.

## Failure modes (and what each surfaces to the client)

| Failure | Response | DB state | UI effect |
|---|---|---|---|
| Non-admin caller | 403 | unchanged | toast "Admin only" |
| Within 5s of previous | 429 + Retry-After | unchanged | toast "Slow down" |
| Refresh already running | 409 | unchanged | toast "Already refreshing" |
| All upstream sets fail | 502 | unchanged | toast "Upstream unreachable" |
| Some upstream sets fail | 207 | failing-set cards get `staleSince=now()`, others updated normally | toast "N changed · M stale" |
| Redis down at invalidation | 200/207 | DB writes succeed | log warn; reads stale until 5min TTL |
| WS broadcast fails | 200/207 | DB writes succeed | open clients update on next page load instead of live |

## Demo seam — `jitter`

Real pokemontcg.io prices change slowly (~daily). For the Loom, refreshes may show zero deltas. Pass `{jitter: 0.05}` to multiply each fetched price by `1 + (random(-1..1) × 0.05)` before write — guarantees visible green/red flashes on the reveal page. Hard-capped at 0.2 (20%) so this can't be weaponised into reporting absurd numbers.

The admin button has a small "demo" checkbox next to it (default ON) that sends `{jitter: 0.05}` when checked, `{}` when unchecked. Uncheck to demo a clean upstream refresh; leave checked for visible drift. The button's tooltip explains the trade-off honestly.

## User flow

1. Admin opens any page → top-nav shows the "↻ Refresh prices" pill.
2. Click → POST /refresh → spinner → toast with the changed/stale counts.
3. Any user (including the admin) with a `/packs/:id/reveal?mode=static` page open sees affected card tiles ring-flash green/red for 800ms; "Now" price and "as of" timestamp update in place; summary panel recomputes "Current value".
