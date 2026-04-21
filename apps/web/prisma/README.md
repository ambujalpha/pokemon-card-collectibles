# apps/web/prisma

Prisma schema + migrations for the Supabase Postgres database.

## Phase 0 schema

- `User` → `users` — email, password hash, balance, held balance, admin flag.
- `Ledger` → `ledger` — append-only audit row per balance movement. One row per `FUND_DEPOSIT`, `PACK_PURCHASE`, `TRADE_*`, `BID_*`, `AUCTION_*` event. See HLD §6.

## Phase 1 additions

- `Card` → `cards` — one row per seeded Pokemon TCG card. `rarityBucket` is our collapsed 5-way enum; see `src/lib/rarity-map.ts` for the pokemontcg.io→bucket table.
- `Drop` → `drops` — one scheduled pack drop per row. Columns: `packTier`, `totalInventory`, `remaining`, `startsAt`, `endsAt`, `status`, `createdBy`. Index on `(status, startsAt)`. The `status` field is a denormalised cache; authoritative status is derived on read (see `src/lib/drop-status.ts`).
- `UserPack` → `user_packs` — one row per pack a user owns. `isRevealed` is false in Phase 1; flips to true in Phase 2. Indexes on `(userId, isRevealed)` and `(userId, dropId)` — the latter powers the D3 "max 5 per user per drop" check during purchase.
- `PackCard` → `pack_cards` — the 5 cards inside a `UserPack`. `pricedCaptured` is the card's basePrice at the moment of purchase, frozen so pull-time P&L stays honest in Phase 3 even as `Card.basePrice` updates.

New enums: `PackTier`, `Rarity`, `DropStatus`.

## Commands

| Command                 | What it does                                                  |
|-------------------------|----------------------------------------------------------------|
| `pnpm prisma:generate`  | Regenerate the Prisma client after schema edits               |
| `pnpm prisma:migrate`   | Create + apply a dev migration against the DB in `DIRECT_URL` |
| `pnpm prisma:studio`    | Web UI at localhost:5555 for inspecting data                  |
| `pnpm seed`             | Run `prisma/seed.ts` — 3 demo users + 3 drops (one per tier)  |
| `pnpm fetch:cards`      | One-off: fetch 200 cards from pokemontcg.io into `cards` table |
| `pnpm calibrate:rarity` | One-off: Monte Carlo tune rarity weights; emits `rarity-weights.ts` + Q&A |

## Migration policy

One migration per branch (CLAUDE.md rule). If you run `prisma migrate dev` multiple times on the same branch, delete the stale files and regenerate a single clean one before pushing.

## Supabase URL split

- `DATABASE_URL` — pooler on port **6543**, `?pgbouncer=true&connection_limit=1`. Runtime queries.
- `DIRECT_URL` — pooler on port **5432** (session mode). Used only by `prisma migrate`.

Both live in `.env` at repo root and at `apps/web/.env` — never committed.

## User flow touching this folder

1. New branch → `prisma migrate dev --name <phase>_<what>` creates + applies a migration.
2. `pnpm fetch:cards` populates the card pool (idempotent — clears existing).
3. `pnpm calibrate:rarity` tunes weights against the real pool, commits `rarity-weights.ts` + calibration QA doc.
4. `pnpm seed` adds demo users and drops. Idempotent: skips users already seeded, skips drop tiers that already have a drop.
