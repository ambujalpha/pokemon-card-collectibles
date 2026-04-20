# apps/web/prisma

Prisma schema + migrations for the Supabase Postgres database.

## Phase 0 schema

- `User` → `users` table — email, password hash, balance, held balance, admin flag.
- `Ledger` → `ledger` table — append-only audit row per balance movement. One row per `FUND_DEPOSIT`, `PACK_PURCHASE`, `TRADE_*`, `BID_*`, `AUCTION_*` event. See HLD §6 and economics/PARAMETERS.md §6.

## Commands

| Command                                  | What it does                                                |
|------------------------------------------|--------------------------------------------------------------|
| `pnpm prisma:generate`                   | Regenerate the Prisma client after schema edits             |
| `pnpm prisma:migrate`                    | Create + apply a dev migration against the DB in `DIRECT_URL` |
| `pnpm prisma:studio`                     | Web UI at localhost:5555 for inspecting data                 |
| `pnpm seed`                              | Run `prisma/seed.ts` — adds demo users                       |

## Migration policy

See the user's global CLAUDE.md: **one migration per branch**. If you run `prisma migrate dev` multiple times on the same branch, delete the stale files and regenerate a single clean one before pushing.

## Notes on Supabase

- `DATABASE_URL` points at the **pooler** (port 6543) with `pgbouncer=true&connection_limit=1` — used by Next.js serverless routes.
- `DIRECT_URL` points at the **direct** endpoint (port 5432) — used by `prisma migrate`. Prisma cannot run DDL through pgbouncer.
- Both URLs live in `.env.local` / Vercel env — never check in a real credential.
