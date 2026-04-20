# PullVault

Pokemon card collectibles platform — scheduled pack drops, live market pricing, peer-to-peer trading, and live auctions.

Work-trial build. See [`docs/`](./docs/) for everything non-code: architecture (HLD), implementation plan, economics parameters, and per-phase Q&A.

## Layout

```
.
├── apps/
│   ├── web/             Next.js 14+ App Router app (HTTP + UI)
│   └── ws/              Socket.io server on Railway (added in Phase 6)
├── packages/
│   └── shared/          Types shared between web + ws
└── docs/                Architecture, plan, economics, Q&A
```

## Stack

- Next.js 14+ App Router + TypeScript + Tailwind CSS
- PostgreSQL on Supabase (via Prisma)
- Redis on Upstash (cache + pub/sub)
- `socket.io` on Railway for live auctions (Phase 6)
- JWT auth (24h single token, httpOnly cookie)
- `decimal.js` everywhere money touches

## Run locally

```bash
# prerequisites: node >= 20, pnpm >= 10
pnpm install
cp .env.example .env.local           # then fill in Supabase / Upstash / JWT secret
pnpm prisma:migrate                   # applies migrations to your Supabase DB
pnpm dev                              # Next.js on http://localhost:3000
```

## Phase tracker

See [`docs/plan/IMPLEMENTATION_PLAN.md`](./docs/plan/IMPLEMENTATION_PLAN.md).

| Phase | Deliverable                        | Status      |
|-------|------------------------------------|-------------|
| 0     | Setup (auth, add-funds, decimal)   | in progress |
| 1     | Pack Drop System                   | pending     |
| 2     | Pack Reveal Experience             | pending     |
| 3     | Live Market Prices                 | pending     |
| 4     | Collection / Portfolio View        | pending     |
| 5     | Peer-to-Peer Marketplace           | pending     |
| 6     | Live Auction Room                  | pending     |
| 7     | Platform Economics Dashboard       | pending     |
