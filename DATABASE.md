# PullVault — Database reference

Postgres 15 on Supabase, accessed via Prisma 6. All schema lives in `apps/web/prisma/schema.prisma`. Every money column is `DECIMAL(18,4)`; every id is UUIDv4; every timestamp is `timestamptz` stored UTC.

## Connection diagram

```
                    ┌───────────────────────────────┐
                    │ apps/web  (Next.js)           │
                    │  • Prisma client              │
                    │  • owns all migrations        │
                    │  • runs every INSERT/UPDATE   │
                    └──────────────┬────────────────┘
                                   │
                  DATABASE_URL     │     DIRECT_URL
                  (pgbouncer 6543) │     (direct 5432, migrations only)
                                   ▼
                    ┌───────────────────────────────┐
                    │  Supabase Postgres 15         │
                    │  schema: public               │
                    └──────────────┬────────────────┘
                                   │ HTTP POST /api/internal/...
                                   │ (X-Internal-Secret)
                                   │
                    ┌──────────────┴────────────────┐
                    │ apps/ws  (socket.io)          │
                    │  • NO direct DB access        │
                    │  • calls web for settle-due   │
                    └───────────────────────────────┘
```

`apps/ws` never touches the database directly. This keeps Prisma + migrations + row-level authority in one process. The ws service is a dumb ticker for the auction close worker and a broadcast relay for WS rooms.

## Entity diagram

```
┌─────────┐     ┌──────────┐     ┌─────────┐     ┌──────────┐
│ users   │────<│ ledger   │     │ cards   │────<│pack_cards│
│         │     │ (audit)  │     │ (200    │     │ (1 per   │
│ balance │     │ ±delta   │     │  types) │     │  pulled) │
│ held    │     │ reason   │     │basePrice│     │priced_cap│
└────┬────┘     └──────────┘     └────┬────┘     └─────┬────┘
     │                                │                │
     │            ┌─────────┐         │          ┌─────┴────┐
     │            │price_   │────────>┘          │user_packs│
     │            │snapshots│ price history      │          │
     │            │ (refresh│                    │isRevealed│
     │            │  log)   │                    │          │
     │            └─────────┘                    └─────┬────┘
     │                                                 │
     │                                                 │
     ├────<                                            │
     │   │                                             │
     │ ┌─┴─────────────┐  per-user         ┌──────────┴───┐
     │ │ user_cards    │  owned            │     drops    │
     │ │ (ownership)   │  1:1 with         │  (inventory) │
     │ │ status        │  pack_cards       │  remaining   │
     │ │ acquiredPrice │                   └──────────────┘
     │ └─┬─────────┬─┬─┘
     │   │         │ │
     │   │         │ └────<┐
     │   │         │       │
     │   │    ┌────┴───┐   │
     │   │    │listings│   │
     │   │    │ ACTIVE │   │    buyer_id → users (same table)
     │   │    │  SOLD  │   │
     │   │    │CANCEL'D│   │
     │   │    └────────┘   │
     │   │                 │
     │   │    ┌────────┐   │
     │   └───>│auctions│◄──┘
     │        │  LIVE  │       winner_id → users
     └───────>│ CLOSED │
              │CANCEL'D│
              └───┬────┘
                  │
               ┌──┴──┐
               │ bids│   (append-only history)
               └─────┘
```

## Tables

### `users`
The account. One row per signed-up user.
| Column         | Type           | Purpose |
|----------------|----------------|---------|
| `id`           | uuid pk        | canonical user id |
| `email`        | text unique    | login identifier |
| `password_hash`| text           | bcrypt hash, cost 12 |
| `balance`      | decimal(18,4)  | spendable funds |
| `balance_held` | decimal(18,4)  | funds locked in active bids |
| `is_admin`     | boolean        | gate for `/admin/*` + `Refresh prices` |
| `created_at`   | timestamptz    | |

### `ledger` (append-only)
Every money movement in the system. The source of truth for revenue + audit.
| Column           | Purpose |
|------------------|---------|
| `user_id`        | whose balance changed |
| `delta`          | signed amount (positive = credit, negative = debit) |
| `reason`         | enum — see below |
| `ref_type`/`ref_id` | what caused it (`pack`, `listing`, `auction`, `drop`) |
| `balance_after`  | user's `balance` after this row — invariant audit |
| `created_at`     | |

**Enum `ledger_reason_enum`:**
- `FUND_DEPOSIT` — top-up via /funds/add.
- `PACK_PURCHASE` — debit on pack buy.
- `TRADE_BUY` — debit on marketplace buy.
- `TRADE_SELL` — credit on marketplace sell (pre-fee).
- `TRADE_FEE` — debit on seller for 5% marketplace fee. Platform revenue.
- `BID_HOLD` — debit on bid place; mirror `balance_held` growth.
- `BID_RELEASE` — credit on outbid or cancel.
- `AUCTION_WIN` — debit on winner's `balance_held` at settlement.
- `AUCTION_SELL` — credit on seller at settlement (pre-fee).
- `AUCTION_FEE` — debit on seller for 10% auction fee. Platform revenue.

**Indexes:** `(user_id, created_at)`, `(reason, created_at)` — the latter powers the admin dashboard.

### `cards`
The 200-card pool from Scarlet & Violet — Paldea Evolved. **One row per unique card type** (not per copy — `pack_cards` records copies). `base_price` is mutable — the admin-triggered price refresh updates it.
| Column          | Purpose |
|-----------------|---------|
| `pokemontcg_id` | upstream id (unique) |
| `rarity_bucket` | our 5-way enum: COMMON / UNCOMMON / RARE / EPIC / LEGENDARY |
| `base_price`    | current market price in USD |
| `last_priced_at`| when base_price was last refreshed |
| `stale_since`   | set if last refresh missed this card (upstream partial) |

### `price_snapshots`
One row per card per refresh tick — full history of `base_price` values. Written by the price-refresh job.
**Indexes:** `(card_id, refreshed_at DESC)`.

### `drops`
Scheduled pack drops. Inventory counter is decremented atomically on purchase.
| Column            | Purpose |
|-------------------|---------|
| `pack_tier`       | STARTER / PREMIUM / ULTRA — sets price + EV |
| `total_inventory` | max packs in this drop |
| `remaining`       | current stock (SELECT FOR UPDATE on purchase) |
| `starts_at` / `ends_at` | schedule window |
| `status`          | SCHEDULED / LIVE / ENDED / SOLD_OUT — denormalised, authoritative via `lib/drop-status.ts` |

### `user_packs`
One row per pack a user has bought. Contains 5 `pack_cards` rows. Flips `is_revealed=true` on first reveal.
**Indexes:** `(user_id, is_revealed)`, `(user_id, drop_id)` (latter powers the per-user-per-drop cap).

### `pack_cards`
The 5 cards inside a user's pack. Created at **purchase time** (generate-on-purchase, not on-reveal). `priced_captured` freezes the market price at that moment — used for at-pull P&L in the reveal summary and P&L dashboards.

### `user_cards`
Per-user **ownership** record. 1:1 with `pack_cards` via a unique index. Ownership transfer via UPDATE `user_id + acquired_price + acquired_at`, not delete+insert, so provenance (which pack, which pull) is preserved across trades.
| Column          | Purpose |
|-----------------|---------|
| `pack_card_id`  | unique — the card's physical instance |
| `user_id`       | current owner |
| `acquired_price`| what the *current* owner paid (ratio-allocated pack cost for pulls, listing price for trades, final bid for auction wins) |
| `status`        | HELD / LISTED / AUCTION / SOLD (SOLD is historical; active row is always on the new owner) |

### `listings`
Marketplace. One active listing per `user_card`. Flips from ACTIVE to SOLD (with buyer + soldAt) or CANCELLED.
**Indexes:** `(status, created_at DESC)`, `(seller_id, status)`.

### `auctions`
One live auction per `user_card` (unique index). `current_bid` + `current_bidder_id` are denormalised high-bid pointers; `bids` is the truth.
| Column                | Purpose |
|-----------------------|---------|
| `starting_bid`        | floor for the first bid |
| `current_bid`         | denormalised high bid |
| `current_bidder_id`   | denormalised current leader |
| `closes_at`           | server-authoritative close time (moves on anti-snipe) |
| `extensions`          | count of +30s extensions applied (cap 20) |
| `status`              | LIVE / CLOSED / CANCELLED |
| `winner_id` / `closed_at` | set at settlement |

### `bids`
Append-only bid history. 50 latest surface on `/auctions/:id`.
**Indexes:** `(auction_id, created_at DESC)`, `(bidder_id, created_at DESC)`.

## Money and precision

- Column type: `DECIMAL(18,4)` everywhere. Never `float` / `double`.
- In TS: `Prisma.Decimal` / `decimal.js` for arithmetic, string serialisation on wire.
- Rounding: `ROUND_HALF_UP` by default; fees use **ceil-to-cent** (seller eats rounding) for deterministic platform revenue.

## Concurrency invariants

1. **Drop purchase** — `SELECT ... FOR UPDATE` on `drops` row, balance check + decrement + ledger rows all in one tx.
2. **Listing purchase** — `SELECT ... FOR UPDATE` on `listings` row; `users` rows locked in id-sorted order to avoid deadlock with concurrent purchases.
3. **Auction bid** — `SELECT ... FOR UPDATE` on `auctions` row; bidder + previous bidder locked in id-sorted order; self-raise holds only the delta.
4. **Auction settle** — `SELECT ... FOR UPDATE SKIP LOCKED` on `auctions` where `closes_at <= now()`; overlapping ticks skip rows that another tx has claimed.

All atomic paths hold their transaction for under ~1s in practice. Timeout is 10–15s per tx.

## Feature → tables

| Feature | Tables it writes | Tables it reads |
|---------|------------------|-----------------|
| Signup / auth / add funds | `users`, `ledger` | `users` |
| Pack drops + purchases | `drops`, `user_packs`, `pack_cards`, `ledger` | `cards`, `drops`, `users` |
| Pack reveal | `user_packs` (isRevealed), `user_cards` | `pack_cards`, `cards` |
| Market price refresh | `cards` (basePrice), `price_snapshots` | `cards` |
| Collection view | — (pure read) | `user_cards`, `cards`, `listings` |
| Marketplace listings | `listings`, `user_cards` (transfer), `ledger` | `user_cards`, `cards`, `users` |
| Auctions | `auctions`, `bids`, `user_cards` (transfer at close), `ledger` | same |
| Admin dashboard | — | `ledger`, `user_packs`, `drops`, `auctions`, `users` |

## Supabase URL split

- `DATABASE_URL` — transaction-pool via pgbouncer port **6543**, `?pgbouncer=true&connection_limit=1`. Used by runtime Prisma queries.
- `DIRECT_URL` — session-mode pooler port **5432**. Used only by `prisma migrate` because migrations need prepared statements pgbouncer doesn't support.

Both live in local `.env` files and are never committed. See `apps/web/prisma/README.md` for more.
