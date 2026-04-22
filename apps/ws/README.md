# apps/ws

Long-lived socket.io server + auction close-worker ticker. Does not talk to the database directly — all DB writes route through `apps/web`'s internal endpoints.

## Files

```
apps/ws/
├── src/
│   ├── index.ts              HTTP + socket.io server bootstrap. Starts close worker at boot.
│   └── internal/
│       ├── broadcast.ts      POST /internal/broadcast handler. Validates X-Internal-Secret, fans {room, event, payload} to sockets.
│       └── close-worker.ts   setInterval(tick, 1000) → POST to WEB_INTERNAL_URL/api/internal/auctions/settle-due. Handles inflight deduping + graceful missing-env fallback.
├── tsconfig.json
└── package.json
```

## Surfaces

### WebSocket rooms (allow-listed for client subscription)
- `drop:<uuid>` — pack drop inventory updates.
- `prices` — global price refresh fan-out.
- `listings` — listing create / sold / cancel fan-out.
- `auctions` — global auction create / close / cancel fan-out.
- `auction:<uuid>` — per-auction live bid + close events.

### WebSocket events (server → client)
| Event | Room | Payload |
|-------|------|---------|
| `inventory_update` | `drop:<id>` | `{ dropId, remaining }` |
| `prices_refreshed` | `prices` | `{ refreshedAt, changes[] }` |
| `listing_event` | `listings` | `{ listingId, event: 'created'|'sold'|'cancelled' }` |
| `auction_event` | `auctions` | `{ auctionId, event: 'created'|'cancelled'|'closed' }` |
| `bid_placed` | `auction:<id>` | `{ auctionId, amount, bidderId, closesAt, extensions }` |
| `auction_closed` | `auction:<id>` | `{ auctionId, winnerId, finalBid }` |

### Client events (client → server)
- `join` / `leave` with `{ dropId }`, `{ auctionId }`, or `{ room }` (room must be in the allow-list).

### HTTP endpoints
- `POST /internal/broadcast` — auth via `X-Internal-Secret` (timing-safe compare against `WS_INTERNAL_SECRET`). Body `{ room, event, payload }`.
- `GET /health` — `{ ok: true, service: 'pullvault-ws' }`.

### Close worker
Runs in the ws process from boot. Every 1s it POSTs to web's `/api/internal/auctions/settle-due` with `X-Internal-Secret`. Web settles up to 20 due auctions per call using `SELECT FOR UPDATE SKIP LOCKED`, broadcasting `auction_closed` for each. If `WEB_INTERNAL_URL` is unset, the worker logs a warning and disables itself (no crash).

## Env vars

| Var | Required | Purpose |
|-----|----------|---------|
| `PORT` | prod | Railway injects; server listens on this. Default `3001` in dev. |
| `WS_INTERNAL_SECRET` | always | ≥16 chars. Shared with `apps/web`; guards `/internal/broadcast` + close-worker auth. |
| `WEB_INTERNAL_URL` | always | Base URL of `apps/web` (e.g. `http://localhost:3000` or the Railway private URL). Required for the close worker; missing = auctions won't auto-settle. |

## Deploy

Railway service in the same project as `apps/web`. Nixpacks auto-detects the workspace. Root directory `apps/ws`. Build: `pnpm install && pnpm --filter ws build`. Start: `pnpm --filter ws start`.

In Railway, set `WEB_INTERNAL_URL` to the **private** URL of the web service (not public) so the traffic stays on Railway's internal network.

## Local dev

```bash
pnpm --filter ws dev        # tsx watch src/index.ts on :3001
```

Or both processes together:

```bash
pnpm dev                    # pnpm-workspace runs web on :3000 + ws on :3001
```

`.env` is loaded via `process.loadEnvFile()` (Node ≥ 20.12). Next.js auto-loads env for `apps/web` but `tsx watch` does not — hence the explicit call at the top of `index.ts`.

## User flow touching this service

### Pack drop inventory
1. User opens `/drops/[id]` → browser calls `subscribeToDropInventory(dropId)` → socket connects, emits `join` with `{ dropId }`.
2. Another user buys a pack. `apps/web`'s purchase tx commits and `emitToRoom('drop:<id>', ...)` POSTs `/internal/broadcast`.
3. Server fans `inventory_update` to the room. All open drop pages tick down.

### Auction close
1. Seller creates an auction on `/sell/:userCardId` → Auction tab.
2. Buyers bid on `/auctions/:id`; each bid route POSTs `/internal/broadcast` to fan `bid_placed` on `auction:<id>`.
3. Close worker ticks every 1s → POSTs `/api/internal/auctions/settle-due` with secret → web settles any auctions whose `closesAt` has passed → per-settlement broadcast fans `auction_closed` back through `/internal/broadcast` → clients see the "🏆 you won" banner.

## Scaling note

Single instance. Multi-instance would need either (a) the socket.io Redis adapter so a broadcast on replica A reaches subscribers on replica B, or (b) leader-elected close worker (Redis SETNX) to avoid N replicas all hammering settle-due. Both are bolt-ons; `SKIP LOCKED` on the web side means duplicate ticks are cheap even without leader election.
