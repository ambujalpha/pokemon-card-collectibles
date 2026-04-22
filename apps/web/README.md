# apps/web

Next.js 16 App Router monolith. Owns the UI, every HTTP endpoint, and all database mutations. Communicates with `apps/ws` via `/internal/broadcast` for WS fan-out.

## Layout

```
apps/web/
├── prisma/                     Schema + migrations + seeder (see ./prisma/README.md)
├── scripts/                    One-off CLI scripts (fetch-cards, calibrate-rarity, inspect-pool, reset-drops)
├── src/
│   ├── app/                    App Router — pages + route handlers (see src/app/api/README.md)
│   │   ├── api/                HTTP endpoints (all mutating paths are tx-wrapped)
│   │   ├── (pages)/            /, /login, /signup, /drops, /collection, /market, /auctions,
│   │   │                       /packs/[id]/reveal, /me/{packs,listings,auctions}, /admin/economics
│   │   ├── layout.tsx          Root layout + fonts
│   │   └── globals.css         Tailwind entry
│   ├── components/             Client + server components (see src/components/README.md)
│   └── lib/                    Server-side utilities (see src/lib/README.md)
├── public/                     Static assets
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Commands

Run from repo root (they delegate into this workspace):

```bash
pnpm dev                              # next dev on :3000
pnpm build                            # production build
pnpm typecheck                        # tsc --noEmit
pnpm lint                             # eslint .
pnpm test                             # vitest run (49 tests across 9 files)
pnpm --filter web prisma migrate dev  # create + apply a migration
pnpm --filter web seed                # idempotent demo seeder
pnpm --filter web fetch:cards         # (re)populate 200-card pool from pokemontcg.io
pnpm --filter web calibrate:rarity    # Monte Carlo rarity calibration
pnpm --filter web reset:drops         # dev helper: zero out inventory + purge user packs
```

## Page map

| URL | Purpose |
|-----|---------|
| `/` | Dashboard — email, balance, add-funds button |
| `/signup`, `/login` | Auth (Phase 0) |
| `/drops` | All scheduled / live drops |
| `/drops/[id]` | Drop detail, live inventory, buy modal |
| `/packs/[id]/reveal` | Animate-mode (first open) or `?mode=static` (revisit) |
| `/me/packs?tab=unopened|opened` | User's packs |
| `/collection` | Owned cards, P&L, sort/filter |
| `/sell/[userCardId]` | Fixed-price / auction sell form |
| `/market`, `/market/[id]` | Browse + buy listings |
| `/me/listings?tab=active|sold|cancelled` | Seller's listings |
| `/auctions`, `/auctions/[id]` | Browse + bid auctions |
| `/me/auctions?tab=selling|bidding|won|sold` | User's auction activity |
| `/admin/economics` | Admin-only platform dashboard |

## Where to look

- **Design** — `/docs/architecture/HLD.md` + `/docs/architecture/ARCHITECTURE.md` + `/docs/architecture/DATABASE.md`
- **Plan** — `/docs/plan/IMPLEMENTATION_PLAN.md` + `PHASE_*.md`
- **Honest Q&A** — `/docs/qa/phase-*.md`
