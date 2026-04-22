# apps/web/src/lib

Server-side utilities used by API routes and server components. Client components must not import from here (most files pull in `next/headers`, `@prisma/client`, or `ioredis` which are server-only).

## Files

### Runtime plumbing
| File | Purpose |
|------|---------|
| `db.ts` | Prisma client singleton. Cached on `globalThis` in dev to survive Next.js HMR. |
| `redis.ts` | ioredis singleton pointed at Upstash via `REDIS_URL`. Error listener downgrades retry storms to `console.warn`. |
| `jwt.ts` | HS256 access-token sign/verify. 24h TTL. Cookie name exported as `ACCESS_TOKEN_COOKIE`. |
| `auth.ts` | `getCurrentUser` reads the cookie, verifies via `jwt.ts`. Used by every API route. |
| `money.ts` | `decimal.js` config (ROUND_HALF_UP, 28 precision) + `parseMoney` / `formatMoney` / `MoneyParseError`. Mandated by HLD ADR-5. |
| `ws-emit.ts` | Server → ws relay. `emitToRoom(room, event, payload)` → POST to `WS_INTERNAL_URL/internal/broadcast` with 1s timeout; fire-and-forget. |
| `ws-client.ts` | `"use client"` socket.io client singleton + typed `subscribeToX` helpers for drop inventory, prices, listings, auctions (per-auction + global). |

### Pack + drop mechanics (Phase 1)
| File | Purpose |
|------|---------|
| `rarity-map.ts` | Maps raw pokemontcg.io rarity strings ("Illustration Rare" etc.) to our 5-way enum. |
| `rarity-weights.ts` | **Auto-generated** by `scripts/calibrate-rarity.ts` — per-tier rarity distribution + pity rules + tier prices + calibrated EV. Do not edit by hand. |
| `pack-picker.ts` | Seeded RNG pack generator — `pickCards(tier, pool, rng)` returns 10 cards honouring weights + pity. Pure; tested. |
| `drop-status.ts` | Derives real drop status (`SCHEDULED/LIVE/ENDED/SOLD_OUT`) from `startsAt/endsAt/remaining` + `now`. `drops.status` is a denormalised cache; this is authoritative. |

### Reveal (Phase 2)
| File | Purpose |
|------|---------|
| `reveal-order.ts` | `sortPackCards(cards)` — sort by rarity ordinal ascending (Common first, Legendary last), position as tiebreak. |
| `reveal-pacing.ts` | Per-rarity flip duration (Common 600ms → Legendary 2500ms). Also `total(cards)` sum. |
| `reveal-pnl.ts` | `computeRevealPnl(pack, cards)` — dual P&L (at-pull + current) with absolute + pct against pack tier price. |
| `spend-allocation.ts` | `allocateSpend(pricedCaptured[], tierPrice)` — distributes pack cost across 10 cards proportional to `pricedCaptured`, residual on last so sum is exact. Used by reveal route + backfill migration. |

### Market prices (Phase 3)
| File | Purpose |
|------|---------|
| `pricing.ts` | `fetchSetPrices(setCode)` (pokemontcg.io), `refreshAllCards({ jitter })` orchestrator, `buildChanges` pure diff, `getCachedPrice(cardId)` cache-through read, `invalidatePriceCache` (SCAN + UNLINK). |

### Marketplace + auctions (Phase 5+6)
| File | Purpose |
|------|---------|
| `marketplace-fee.ts` | `computeTradeFee(ask)` → 5% ceil-to-cent fee + sellerNet. |
| `auction-math.ts` | `minNextBid` (5% floor $0.10), `applyAntiSnipe(now, closesAt, extensions)`, `computeAuctionFee` (10% ceil), `resolveDuration` (`2m/5m/10m` presets). |

### Admin dashboard (Phase 7)
| File | Purpose |
|------|---------|
| `economics.ts` | `computeEconomics(window)` aggregates ledger + sales for the admin dashboard. `snapshotToCsv` exports as flat CSV. `windowSince` resolves `today/7d/30d/all`. |

### Tests
Tests live next to their subject as `*.test.ts`. Run with `pnpm test` (or `pnpm test:watch`).
`pack-picker.test.ts`, `rarity-map.test.ts`, `reveal-order.test.ts`, `reveal-pnl.test.ts`, `pricing.test.ts`, `spend-allocation.test.ts`, `marketplace-fee.test.ts`, `auction-math.test.ts`, `economics.test.ts` — 49 tests total.

## Rules for new files

- **Server-only.** Shared types go to `packages/shared`.
- **Throw on env problems.** Missing `JWT_SECRET`, `REDIS_URL`, `DATABASE_URL` must crash on first call.
- **Money via `decimal.js`** — never `Number()` or `parseFloat`.
- **Pure where possible.** Anything that can be written without IO gets a unit test.
