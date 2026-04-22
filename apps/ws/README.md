# apps/ws

Long-lived socket.io server for PullVault.

**Status:** activated in **Phase 1** (scope-shifted from the original Phase 6 plan — see `docs/architecture/HLD.md` ADR-8 amendment dated 2026-04-21). The Vercel→Railway hosting pivot moved both services onto the same platform, which also made it cheap to stand up WS earlier.

## Phase 1 surface (current)

- **One socket.io namespace** `/` with rooms `drop:<uuid>`.
- **Two client events** — `join` and `leave`, each takes `{ dropId }`.
- **One server-emitted event** — `inventory_update` with `{ dropId, remaining }`, broadcast to all sockets in `drop:<uuid>`.
- **One internal HTTP endpoint** — `POST /internal/broadcast`, protected by `X-Internal-Secret` header compared via `timingSafeEqual`. Body `{ room, event, payload }`. `apps/web` calls this after a pack purchase commits.
- **Health** — `GET /health` returns `{ ok: true, service: 'pullvault-ws' }`.

Single instance. No Redis adapter (that lands in Phase 6 when we run multi-instance).

## Phase 6 plan (not yet built)

- Auction rooms `auction:<uuid>` with event `bid_placed` and `auction_extended`.
- Redis adapter (`@socket.io/redis-adapter` via `ioredis` pub/sub) so multiple ws instances broadcast to the same room.
- Per-second global close-worker tick process that emits `auction_closed` (HLD §7.5 + ADR-9).
- Optional JWT check on auction-room joins so spectators/bidders can be distinguished.

## Deploy

Railway service in the same project as `apps/web`. Nixpacks auto-detects the workspace. Root directory `apps/ws`. Build: `pnpm install && pnpm --filter ws build`. Start: `pnpm --filter ws start`.

## Env vars

| Var                     | Required | What it does                                                       |
|-------------------------|----------|---------------------------------------------------------------------|
| `PORT`                  | prod     | Railway injects this; server calls `listen(process.env.PORT)`      |
| `WS_INTERNAL_SECRET`    | always   | Shared with `apps/web`; rejects `/internal/broadcast` without it   |
| `DATABASE_URL`          | Phase 6  | Same pooled URL as web; unused in Phase 1 but wired for continuity |

## User flow touching this service

1. User loads `/drops/[id]` in the browser.
2. The client calls `subscribeToDropInventory(dropId)` → opens a ws connection to `NEXT_PUBLIC_WS_URL` → emits `join` with the drop id. Server adds the socket to room `drop:<id>`.
3. Another user buys a pack elsewhere. `apps/web`'s purchase route commits and calls `emitToRoom('drop:<id>', 'inventory_update', {remaining})` → that becomes an internal `POST /internal/broadcast`.
4. Server broadcasts `inventory_update` to every socket in `drop:<id>`. All open drop pages see the counter tick down within ~100ms.
5. On the drop detail page, the client uses the push to refresh `remaining` and (if it hits 0) the "Sold out" badge.

## Local dev

```
pnpm --filter ws dev       # tsx watch src/index.ts, listens on :3001
```

Runs independently of the Next.js web server. Start both with `pnpm dev:all` from the repo root.
