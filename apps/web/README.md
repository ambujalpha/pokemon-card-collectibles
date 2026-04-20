# apps/web

The Next.js 14+ App Router monolith. Serves the UI, owns all HTTP endpoints, and reads/writes Postgres + Redis.

## Layout

```
apps/web/
├── prisma/
│   ├── schema.prisma        Data model (see README in this folder)
│   ├── migrations/          Generated migrations (kept single-per-branch)
│   └── seed.ts              Demo-user seeder (added end of Phase 0)
├── src/
│   ├── app/                 App Router pages + route handlers
│   │   ├── (auth)/          /signup, /login (unauthenticated)
│   │   ├── (app)/           Authenticated area (dashboard, collection, market…)
│   │   └── api/             Route handlers — all mutating routes are txn-wrapped
│   ├── components/          Client + server React components
│   └── lib/                 Server-side utilities (db, redis, money, jwt, auth)
├── public/                  Static assets
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Commands

Run from repo root (they delegate into this workspace):

```bash
pnpm dev                     # next dev on :3000
pnpm build                   # production build
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint .
pnpm prisma:migrate          # apply a new migration
pnpm seed                    # add demo users
```

## Where to look

- **Design** — `/docs/architecture/HLD.md`
- **Plan for this phase** — `/docs/plan/IMPLEMENTATION_PLAN.md`
- **Honest Q&A** — `/docs/qa/phase-0-setup.md`
