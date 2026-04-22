# PullVault

Pokemon card collectibles platform — scheduled pack drops, live market pricing, peer-to-peer trading, and live auctions with anti-snipe. Work-trial build.

**Canonical docs:** [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) (2-pager), [`docs/architecture/HLD.md`](./docs/architecture/HLD.md) (full), [`docs/architecture/DATABASE.md`](./docs/architecture/DATABASE.md) (schema + diagrams), and per-phase Q&A under [`docs/qa/`](./docs/qa/).

## Layout

```
.
├── apps/
│   ├── web/             Next.js 16 App Router — UI + every HTTP endpoint + Prisma owner
│   └── ws/              socket.io server on Railway — broadcast relay + auction close worker
├── packages/
│   └── shared/          Types shared between web + ws
└── docs/                Architecture, plan, economics, Q&A
```

## Stack

- **Framework** — Next.js 16 (App Router), TypeScript 5, Tailwind CSS 4
- **Database** — PostgreSQL 15 on Supabase, Prisma 6 ORM
- **Cache** — Redis on Upstash (`price:<cardId>`, 5-min TTL)
- **Realtime** — socket.io on a separate Node process (Railway)
- **Auth** — JWT HS256 in httpOnly cookie, bcrypt (cost 12)
- **Money** — `decimal.js` / `Prisma.Decimal(18, 4)` — no float arithmetic on the balance path
- **Pricing source** — pokemontcg.io (200 cards from Scarlet & Violet — Paldea Evolved)
- **Tests** — vitest (49 unit tests)

## Run locally

Prerequisites: Node ≥ 20.12, pnpm ≥ 10.

```bash
pnpm install

# Fill both files with Supabase + Upstash URLs + a 32+ char JWT_SECRET
# + a 16+ char WS_INTERNAL_SECRET. See docs/architecture/HLD.md §5.
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/ws/.env.example apps/ws/.env

pnpm --filter web prisma migrate deploy    # applies migrations
pnpm --filter web seed                     # 3 demo users (incl. admin@pullvault.local), 3 drops
pnpm --filter web fetch:cards              # 200 cards from pokemontcg.io (idempotent)
pnpm --filter web calibrate:rarity         # tune rarity weights against the pool

pnpm dev                                    # web on :3000, ws on :3001
```

Demo logins (from `prisma/seed.ts`):
- `admin@pullvault.local` / `password123` (admin; sees Economics + Refresh prices)
- `alice@pullvault.local` / `password123`
- `bob@pullvault.local` / `password123`

## Phase tracker

See [`docs/plan/IMPLEMENTATION_PLAN.md`](./docs/plan/IMPLEMENTATION_PLAN.md).

| Phase | Deliverable                        | Status |
|-------|------------------------------------|--------|
| 0     | Setup (auth, add-funds, decimal)   | ✅ |
| 1     | Pack Drop System                   | ✅ |
| 2     | Pack Reveal Experience             | ✅ |
| 3     | Live Market Prices                 | ✅ |
| 4     | Collection / Portfolio View        | ✅ |
| 5     | Peer-to-Peer Marketplace           | ✅ |
| 6     | Live Auction Room                  | ✅ |
| 7     | Platform Economics Dashboard       | ✅ |

## Feature tour

| What | Where |
|------|-------|
| Buy a pack from a live drop | `/drops`, `/drops/[id]` |
| Reveal a pack (rarity-scaled card flip) | `/packs/[id]/reveal` |
| Revisit an opened pack | `/packs/[id]/reveal?mode=static` |
| Collection with P&L | `/collection` |
| List a card for sale | `/sell/[userCardId]` |
| Browse / buy listings | `/market`, `/market/[id]` |
| Your listings | `/me/listings` |
| Browse / bid auctions | `/auctions`, `/auctions/[id]` |
| Your auctions | `/me/auctions` |
| Admin economics dashboard | `/admin/economics` |
| Admin price refresh | button in top-right when admin |

## Key numbers

- 3 pack tiers: $5 / $20 / $50 (Starter / Premium / Ultra)
- 10 cards per pack, 5 rarity buckets (Common / Uncommon / Rare / Epic / Legendary)
- Marketplace fee: **5%** (ceil-to-cent, seller eats rounding)
- Auction fee: **10%** (same rounding rule)
- Anti-snipe: bid inside final **30s** extends close by **+30s**, cap **20** extensions
- Auction durations: **2m / 5m / 10m** (demo-friendly)
- Price refresh: admin button only (no cron in v1)

## Concurrency & correctness claims

Every mutation path that can race is wrapped in a Prisma transaction with `SELECT ... FOR UPDATE` on the contended row. Cross-user locks (buyer + seller, bidder + prev-bidder) are acquired in **id-sorted order** to prevent deadlock. The auction close worker uses `FOR UPDATE SKIP LOCKED` so overlapping ticks can't double-settle.

Details in [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md) §Concurrency.

## Testing

```bash
pnpm --filter web test        # 49 unit tests across 9 files
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
```

Integration tests against a real DB are deferred — flagged honestly in per-phase Q&A. Manual smoke-test playbooks are in `docs/qa/phase-*.md` §5.
