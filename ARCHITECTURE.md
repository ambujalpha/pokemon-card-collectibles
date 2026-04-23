# PullVault — Architecture

Reviewer-facing architecture. Covers system shape, real-time topology, concurrency, pack economics, auction mechanics, caching, scalability, and security. Schema detail in [`DATABASE.md`](./DATABASE.md).

---

## 1. System shape

Two processes deployed on Railway:

```
   Browser
   ┌─────────────────────────────┐
   │  Next.js client + socket.io │
   └──────┬───────────────┬──────┘
          │ HTTP          │ WSS
          ▼               ▼
  ┌──────────────┐   ┌──────────────┐
  │  apps/web    │   │   apps/ws    │
  │  (Next.js)   │   │ (socket.io)  │
  │              │   │              │
  │ Prisma owns  │   │ rooms +      │
  │ all DB I/O   │   │ close worker │
  └──────┬───────┘   └──────┬───────┘
         │ Prisma           │
         │                  │ HTTP POST /api/internal/*
         ▼                  │   (X-Internal-Secret)
  ┌──────────────┐          │
  │  Supabase    │◄─────────┘
  │  Postgres 15 │
  └──────┬───────┘
         │
  ┌──────┴───────┐
  │ Upstash      │  price:<cardId> cache (5-min TTL)
  │ Redis        │
  └──────────────┘
```

- `apps/web` owns **all** DB writes. Prisma client + migrations live in one place.
- `apps/ws` is a thin socket.io server + close-worker ticker. **No direct DB access** — it POSTs to the web service for settlement and acts as a broadcast relay.
- Redis is a cache only. No pub/sub is used: the web → ws fan-out is a plain HTTP POST from the mutation handler, which keeps causality (DB commit happens-before broadcast) trivial.

### Stack

Next.js 16 App Router · TypeScript 5 · Tailwind 4 · PostgreSQL 15 (Supabase) · Prisma 6 · Upstash Redis · socket.io · JWT HS256 · bcrypt cost 12 · `decimal.js` / `Prisma.Decimal(18, 4)`.

---

## 2. Real-time topology

### 2.1 Channels (socket.io rooms)

The client joins rooms for pages it is currently viewing, plus broadcast rooms it has opted into. Servers never push to individual sockets — always to a room.

| Room | Publishers | Subscribers | Payload |
|------|-----------|-------------|---------|
| `drop:<uuid>` | pack-purchase handler (`/api/drops/:id/purchase`) | drop detail page viewers | `{ dropId, remaining }` |
| `prices` | price-refresh handler (`/api/admin/prices/refresh`) | reveal-static, collection, market, auction pages | `{ refreshedAt, changes[] }` |
| `listings` | listing create / cancel / purchase | market + collection + listings pages | `{ listingId, event: 'created' \| 'sold' \| 'cancelled' }` |
| `auctions` | auction create / cancel / close | auctions browse page | `{ auctionId, event: 'created' \| 'cancelled' \| 'closed' }` |
| `auction:<uuid>` | bid handler, close worker (via web) | auction detail viewers | `bid_placed`: `{ auctionId, amount, bidderId, closesAt, extensions }` / `auction_closed`: `{ auctionId, winnerId, finalBid }` |

**Room naming** uses a typed prefix (`drop:`, `auction:`) for per-entity rooms, and a bare name (`prices`, `listings`, `auctions`) for allow-listed global rooms. The ws service validates the UUID and the allow-list before attaching a socket to any room.

### 2.2 Publish-after-commit discipline

Every mutation handler that ends in a broadcast does so **after** the Prisma transaction commits. Broadcasts are fire-and-forget with a 1s timeout; a failed broadcast is logged but never rolls back the DB. Rationale: the DB is the authority. Clients that miss an event recover on the next focus or by refetching.

### 2.3 Server-authoritative timers

- `auctions.closes_at` is the only clock that matters. Browsers render countdowns from it but cannot move it.
- Bids that arrive with `now() >= closes_at` are rejected with 409 `already_closed` even if the client's clock claims the auction is still live.
- Auction close is evaluated by a worker in `apps/ws` that ticks every 1s and asks web to settle any due rows.

---

## 3. Concurrency model

Every mutation that can race runs inside a single Prisma `$transaction` with `ReadCommitted` isolation and `SELECT ... FOR UPDATE` on the contended row.

| Path | Contended row | Extra locks | Invariant |
|------|---------------|-------------|-----------|
| Pack purchase (`/api/drops/:id/purchase`) | `drops` | user row | `remaining ≥ 0`; 5 pack_cards generated + `user_cards` on reveal |
| Listing purchase (`/api/listings/:id/purchase`) | `listings` | buyer + seller `users` id-sorted | buyer − price / seller + sellerNet / seller − fee → net sellerNet |
| Auction bid (`/api/auctions/:id/bid`) | `auctions` | bidder + prev bidder `users` id-sorted | outbid releases exactly once; self-raise holds only delta |
| Auction settle (`/api/internal/auctions/settle-due`) | `auctions` with `FOR UPDATE SKIP LOCKED` | winner + seller `users` id-sorted | exactly one settlement per auction, even under overlapping ticks |

**Deadlock avoidance.** Wherever a tx locks two user rows, it grabs them in **id-sorted** order (`ORDER BY id FOR UPDATE`). Two concurrent transactions on the same pair always take the locks in the same order → no cycle → no deadlock.

**Ledger invariant.** Every balance mutation writes a `ledger` row in the same transaction as the balance update. `users.balance` is always reconstructable as `SUM(ledger.delta) WHERE user_id = ...`. A sanity-check job can audit this; deviation is a bug.

---

## 4. Pack economics

Three pack tiers with diminishing house edge — classic VIP ladder: bigger price, tighter EV envelope.

| Tier    | Price | Cards | Target EV | EV % | House edge |
|---------|-------|-------|-----------|------|------------|
| Starter | $5.00 | 5 | $3.25 | 65% | 35% |
| Premium | $20.00 | 5 | $15.00 | 75% | 25% |
| Ultra   | $50.00 | 5 | $42.50 | 85% | 15% |

### Rarity ladder

| Rarity    | Code | UI cue |
|-----------|------|--------|
| Common    | C | grey |
| Uncommon  | U | green |
| Rare      | R | blue |
| Epic      | E | purple + particles |
| Legendary | L | gold + particles + long tease |

Per-tier rarity weights are calibrated against the real 200-card pool via `scripts/calibrate-rarity.ts` and written into `src/lib/rarity-weights.ts`. Re-run after any pool or price change.

### EV realisation

Target EV is computed from weights × seed-time card prices. **Realised EV** is `SUM(pack_cards.priced_captured)` across pulled cards — `priced_captured` is the market price frozen at the moment of the pack sale, so P&L stays honest even if `cards.base_price` drifts later.

The admin dashboard surfaces `realised_margin = (revenue − Σ priced_captured) / revenue` per tier. Because target EV uses calibration-time prices, realised margin drifts if market prices move after calibration — an expected property; production would re-calibrate weekly.

### Per-card acquisition cost (ratio allocation)

A Premium pack bought at $20 yielding 5 cards with `Σ priced_captured = $12.40` gives each card a `user_cards.acquired_price` of `(own priced_captured / 12.40) × 20`, with the rounding residual on the last card so the sum equals $20 exactly. Result: the collection page shows honest P&L (paid $20 for $X current value), not a synthetic "paid what these were then worth".

### Published odds

Per-tier rarity percentages are visible in the UI (buy-pack modal + admin dashboard). Hiding odds fails reviewer scrutiny and the dashboard requirement forces them public anyway.

---

## 5. Auction mechanics

| Parameter | Value |
|-----------|-------|
| Duration options | 2 / 5 / 10 minutes (demo-friendly presets) |
| Minimum bid increment | `max(5% × current, $0.10)`, ceil-to-cent |
| Anti-snipe window | last 30 seconds |
| Anti-snipe extension | +30 seconds per late bid |
| Extension cap | 20 (worst-case tail = 10 extra minutes) |
| Winner fee | 10% of final bid, ceil-to-cent, seller eats rounding |

### Fund hold model

`balance_held` (a second column on `users`) covers the bidder's current high bid. Five ledger reasons model the flow:

- `BID_HOLD` — on bid placement, `balance -= amount`, `balance_held += amount`.
- `BID_RELEASE` — on outbid or cancel, inverse.
- `AUCTION_WIN` — at settlement, `balance_held -= final_bid` for the winner.
- `AUCTION_SELL` — at settlement, `balance += sellerNet` for the seller.
- `AUCTION_FEE` — at settlement, `balance -= fee` for the seller (platform revenue).

### Four non-obvious correctness properties

1. **Bid increment is a server-side formula**, not a client hint. The client's displayed minimum is advisory; the server re-computes and 409s if the bid doesn't clear.
2. **Self-raise holds only the delta.** Raising your own bid from $30 to $35 debits $5 (not $35), by detecting `currentBidderId === session.userId`.
3. **Anti-snipe is evaluated inside the bid transaction.** The same tx that writes the bid also pushes `closes_at += 30s` and increments `extensions`. There is no window where the auction could close between bid-accept and extension.
4. **Close worker uses `SKIP LOCKED`.** If multiple ws replicas ever exist, overlapping ticks skip rows another tx has claimed. One replica wins per auction — correctness over deduplication cost.

### Worked timeline

```
T = 0:00    auction opens,       closes_at = T+10:00
T = 9:30    user A bids $10      closes_at unchanged (outside 30s window)
T = 9:45    user B bids $10.50   closes_at → T+10:15   (extension 1/20)
T = 10:10   user A bids $11.00   closes_at → T+10:40   (extension 2/20)
...
            21st late bid accepted but closes_at NOT extended.
```

---

## 6. Marketplace mechanics

- Seller lists a HELD `user_card` at any `priceAsk`. UI warns above 200% of current market; no hard cap.
- Buyer purchase is atomic — `SELECT FOR UPDATE` on the listing + id-sorted lock on (buyer, seller) `users` rows.
- **5% fee**, ceil-to-cent, seller eats rounding (worked example: ask $20 → buyer pays $20, fee $1.00, seller nets $19.00).
- Three ledger rows per sale: `TRADE_BUY` (buyer −price), `TRADE_SELL` (seller +sellerNet), `TRADE_FEE` (seller −fee). Platform has no user row → `TRADE_FEE` is written against the seller with a negative delta; platform revenue = `SUM(-delta) WHERE reason = 'TRADE_FEE'`.
- Ownership transfer is an UPDATE of `user_cards.userId + acquiredPrice + acquiredAt` — not delete+insert — so pull provenance (via `pack_card_id`) survives across trades.

---

## 7. Caching strategy

| Read | Cache | TTL | Invalidation |
|------|-------|-----|--------------|
| `price:<cardId>` | Upstash Redis | 5 min | SCAN + UNLINK on price refresh |
| `/api/admin/economics` snapshot | process-local `Map` (per window) | 5 min | `?fresh=1` bypass + manual Refresh button |

### What is **not** cached

- Balances — every read hits the DB.
- Listings / auctions current state — every read hits the DB.
- JWT validation — stateless, no cache needed.

**Rule:** only read-heavy, display-only, eventually-consistent data is cached. Anything money-related reads the DB.

---

## 8. Security

- **Passwords** — bcrypt cost 12, never logged.
- **Session** — JWT HS256 in an httpOnly cookie, 24h TTL. `JWT_SECRET` (≥32 chars) mandatory.
- **Internal endpoints** (`/api/internal/*`) — auth via `X-Internal-Secret` header, timing-safe compared against `WS_INTERNAL_SECRET` (≥16 chars, shared by web + ws).
- **Admin endpoints** — `users.is_admin = true` gate, 403 otherwise.
- **Input validation** — UUIDs via regex; money values via `parseMoney` (`decimal.js`, rejects NaN/Infinity/negative); structured bodies hand-validated.
- **Money** — `decimal.js` for every arithmetic operation. Float arithmetic is banned on the balance path.
- **SQL** — parameterised everywhere (Prisma + `$queryRaw` tagged templates); no string interpolation into SQL.

---

## 9. Scalability posture

Everything shipped is single-instance safe. Multi-instance would require three bolt-ons:

| Current | Multi-instance upgrade |
|---------|-------------------------|
| Process-local price-refresh mutex (409 `already_running`) | Redis SETNX lease |
| Process-local economics-snapshot cache | Redis-backed snapshot |
| socket.io rooms are per-pod | `@socket.io/redis-adapter` + Upstash pub/sub |
| Close worker runs on every ws replica | Leader election via Redis SETNX (or rely on `SKIP LOCKED` — duplicate ticks are cheap) |

Railway currently deploys one web + one ws container. The code is structured so that each upgrade is additive, not a rewrite.

---

## 10. Testing

- **49 unit tests** across nine files — pack-picker, rarity-map, reveal-order, reveal-pnl, price diff, spend allocation, marketplace fee, auction math, economics CSV.
- Integration tests against a real DB are deferred; atomic paths verified manually.
- Every pure helper on a money or ordering path is tested; impure paths (DB transactions) are exercised only in manual smoke tests.

---

## 11. Known trade-offs

Honest list — these are deliberate, not overlooked:

- **No integration tests on DB-backed atomic paths.** Unit coverage is ~100% of pure helpers; transactional paths verified manually.
- **No per-user WS rooms.** Clients refetch on public listing/auction events rather than receive targeted pushes. At demo scale the refetch cost is invisible; at scale this is the first thing to migrate.
- **Process-local caches** (price-refresh mutex, economics snapshot) — flagged for Redis migration before horizontal scaling.
- **No cron for price refresh.** Admin button triggers refresh; production would wire a scheduler (or a ws-style ticker) to POST the same endpoint daily.
- **Platform has no user row** — `TRADE_FEE` / `AUCTION_FEE` are written against the seller with a negative delta. Revenue = `SUM(-delta) WHERE reason IN ('TRADE_FEE','AUCTION_FEE')`. A real platform would want a dedicated ledger target for auditability.
- **Clock skew.** Server `now()` is authoritative on auction close; clients with drift see a momentary "closing…" before settlement lands.
