# apps/web/prisma

Prisma schema + migrations for the Supabase Postgres database. Full model and column reference with diagrams in [`docs/architecture/DATABASE.md`](../../../docs/architecture/DATABASE.md).

## Models (current)

### Phase 0 — accounts + audit
- `User` → `users` — email, password hash, `balance`, `balance_held`, `is_admin`. Every money movement has a matching `Ledger` row.
- `Ledger` → `ledger` — append-only. Enum `LedgerReason`: FUND_DEPOSIT / PACK_PURCHASE / TRADE_BUY / TRADE_SELL / TRADE_FEE / BID_HOLD / BID_RELEASE / AUCTION_WIN / AUCTION_SELL / AUCTION_FEE. Indexed on `(user_id, created_at)` and `(reason, created_at)` (latter powers Phase 7).

### Phase 1 — pack system
- `Card` → `cards` — 200-card pool from Scarlet & Violet — Paldea Evolved. Mutable `basePrice` (Phase 3 refreshes it); `rarity_bucket` is our collapsed 5-way enum; `lastPricedAt` + `staleSince` added in Phase 3.
- `Drop` → `drops` — scheduled pack drop with `packTier` + `totalInventory` + `remaining`. Indexed on `(status, startsAt)`.
- `UserPack` → `user_packs` — one per pack purchased; `isRevealed` flips in Phase 2. Indexed on `(userId, isRevealed)` + `(userId, dropId)`.
- `PackCard` → `pack_cards` — the 10 cards inside a pack, generated at purchase. `pricedCaptured` freezes the market price at purchase time.

Enums: `PackTier`, `Rarity`, `DropStatus`.

### Phase 3 — price history
- `PriceSnapshot` → `price_snapshots` — one row per card per refresh. Indexed on `(cardId, refreshedAt DESC)`.

### Phase 4+5 — ownership + marketplace
- `UserCard` → `user_cards` — per-user ownership record; 1:1 with `PackCard` via unique index. `status` enum HELD/LISTED/AUCTION/SOLD. Transfer on sale UPDATEs `userId + acquiredPrice + acquiredAt`. Indexed on `(userId, status)` and `(cardId)`.
- `Listing` → `listings` — marketplace listings with `priceAsk`, `status`, optional `buyerId/soldAt/cancelledAt`. Indexed on `(status, createdAt DESC)` + `(sellerId, status)`.

Enums: `UserCardStatus`, `ListingStatus`.

### Phase 6 — auctions
- `Auction` → `auctions` — one per `user_card` (unique index). Denormalised `currentBid` + `currentBidderId` for fast read; `closesAt` extensible by anti-snipe (`extensions` capped at 20). `status` enum LIVE/CLOSED/CANCELLED. Indexed on `(status, closesAt)` + `(sellerId, status)`.
- `Bid` → `bids` — append-only. Indexed on `(auctionId, createdAt DESC)` + `(bidderId, createdAt DESC)`.

Enum: `AuctionStatus`.

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm --filter web prisma:generate` | Regenerate Prisma client after schema edits. |
| `pnpm --filter web prisma migrate dev --name <phase>_<name>` | Create + apply a dev migration against `DIRECT_URL`. |
| `pnpm --filter web prisma studio` | Web UI at localhost:5555 for inspecting data. |
| `pnpm --filter web seed` | 3 demo users (admin + alice + bob) + 3 drops (one per tier). Idempotent. |
| `pnpm --filter web fetch:cards` | Fetch 200 cards from pokemontcg.io into `cards`. Clears and re-inserts. |
| `pnpm --filter web calibrate:rarity` | Monte Carlo tune rarity weights; emits `src/lib/rarity-weights.ts` + calibration Q&A. |
| `pnpm --filter web reset:drops` | Dev helper: reset `drops.remaining` to `totalInventory` + delete user packs/cards. |

## Migration policy

**One migration per branch.** If `prisma migrate dev` is re-run on the same branch, delete stale files and regenerate a single clean one before pushing. (See `CLAUDE.md` project rules.)

Current migrations on `main` after Phases 0–7:
- `20260420053723_init`
- `20260421041753_phase1_pack_drops`
- `20260422054810_phase3_price_history`
- `20260422111424_phase4_5_marketplace` (backfills `user_cards` from revealed packs)
- `20260422115254_phase6_auctions`

Phase 7 added no migration (read-only).

## Supabase URL split

- `DATABASE_URL` — pooled on port **6543** (`?pgbouncer=true&connection_limit=1`). Runtime queries.
- `DIRECT_URL` — direct on port **5432**. Used only by `prisma migrate` (prepared statements don't work through pgbouncer).

Both live in `./.env` and `./apps/web/.env`, never committed.

## Seed files

- `prisma/seed.ts` — idempotent demo data seeder (3 users, 3 drops).

## User flow touching this folder

1. New branch → `prisma migrate dev --name <phase>_<name>` creates + applies a migration.
2. `pnpm fetch:cards` populates the card pool (idempotent — truncates existing).
3. `pnpm calibrate:rarity` tunes weights against the pool; commits `rarity-weights.ts` + calibration Q&A.
4. `pnpm seed` adds demo users + drops. Safe to re-run — skips existing rows.
