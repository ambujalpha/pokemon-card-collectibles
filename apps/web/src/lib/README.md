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
| `money.ts` | `decimal.js` config (ROUND_HALF_UP, 28 precision) + `parseMoney` / `formatMoney` / `MoneyParseError`. Every money value goes through this module — never raw floats. |
| `ws-emit.ts` | Server → ws relay. `emitToRoom(room, event, payload)` → POST to `WS_INTERNAL_URL/internal/broadcast` with 1s timeout; fire-and-forget. |
| `ws-client.ts` | `"use client"` socket.io client singleton + typed `subscribeToX` helpers for drop inventory, prices, listings, and auctions (per-auction + global). |

### Pack + drop mechanics
| File | Purpose |
|------|---------|
| `rarity-map.ts` | Maps raw pokemontcg.io rarity strings ("Illustration Rare" etc.) to our 5-way enum. |
| `rarity-weights.ts` | **Auto-generated** by `scripts/calibrate-rarity.ts` — per-tier rarity distribution + pity rules + tier prices + calibrated EV. Used as the `baseShape` seed for the solver and as the fallback when no active `pack_weight_versions` row exists. Do not edit by hand. |
| `active-weights.ts` | Reads the *active* `pack_weight_versions` row for a tier, with a 60 s process-local TTL cache. Pinned-version lookup for audit/reveal paths. `invalidateActiveWeights()` is called by the rebalance route. |
| `pack-picker.ts` | Seeded RNG pack generator — `pickCards(tier, pool, rng)` (static weights) and `pickCardsWithWeights(tier, pool, weights, rng)` (caller-supplied vector, used by the solver-driven purchase path). Pure; tested. |
| `drop-status.ts` | Derives real drop status (`SCHEDULED/LIVE/ENDED/SOLD_OUT`) from `startsAt/endsAt/remaining` + `now`. `drops.status` is a denormalised cache; this is authoritative. |

### Economics solver
| File | Purpose |
|------|---------|
| `economics/solver.ts` | Closed-form per-tier weight solver. Inputs: tier price, target margin, bucket means, `baseShape`, win-rate floor. Output: weight vector + realised margin + `constraintBinding`. Pure; tested. |
| `economics/winRate.ts` | `WIN_FRACTION` (= 0.6 of tier price) + per-tier `WIN_RATE_FLOORS` (0.40 / 0.50 / 0.60). |
| `economics/simulate.ts` | Seeded Monte-Carlo over N pack openings (`mulberry32`). Used by tests and by the admin simulate route. |
| `economics/bucket-means.ts` | DB read of mean card price per bucket from the latest `price_snapshots` row per card; falls back to `cards.base_price`. |

### Anti-bot + fairness (admission)
| File | Purpose |
|------|---------|
| `ratelimit.ts` | Sliding-window-log rate limiter via Redis Lua. `checkLimit(key, opts)` + `checkLimits(specs[])`. Atomic prune→count→add. |
| `fairness.ts` | `jitter(maxMs = 500)` admission helper — randomises order before the row-lock so bot network speed loses its edge. |
| `behavioralSignals.ts` | Four-signal risk scorer (rapidPurchase / freshSession / multiAccount / fastReveal). Threshold `100`; no single signal can flag. UA hashed via SHA-256[:16]. |

### Auction integrity
| File | Purpose |
|------|---------|
| `auction-math.ts` | `minNextBid` (5% floor $0.10), `applyAntiSnipe(now, closesAt, extensions)`, `computeAuctionFee` (10% ceil), `resolveDuration` (`2m/5m/10m` presets). |
| `auction-integrity.ts` | 5× fat-finger overbid cap, 2 s per-user-per-auction Redis lock (`tryClaimBidSlot`), sealed-window detection + redaction helpers. |
| `wash-trade-detect.ts` | Three post-close heuristics (`repeat_pair`, `thin_low_clearance`, `linked_high_clearance`) writing to `auction_flags`. Review queue, never auto-actions. |

### Provably fair pack openings
| File | Purpose |
|------|---------|
| `fairness/commit.ts` | `newCommit()`, `verifyCommit()`, `sha256Hex()` — server seed via `crypto.randomBytes(32)`. |
| `fairness/roll.ts` | Deterministic HMAC-SHA-256 roll — 5 × 48-bit uniforms per chain, mapped through pinned weights and a sorted card pool. Same maths as the browser verifier. |
| `chi-squared.ts` | Pure GOF + Wilson–Hilferty p-value for the fairness audit endpoint and dashboard alerts. |

### Pack reveal
| File | Purpose |
|------|---------|
| `reveal-order.ts` | `sortPackCards(cards)` — sort by rarity ordinal ascending (Common first, Legendary last), position as tiebreak. |
| `reveal-pacing.ts` | Per-rarity flip duration (Common 600ms → Legendary 2500ms). Also `total(cards)` sum. |
| `reveal-pnl.ts` | `computeRevealPnl(pack, cards)` — dual P&L (at-pull + current) with absolute + pct against pack tier price. |
| `spend-allocation.ts` | `allocateSpend(pricedCaptured[], tierPrice)` — distributes pack cost across 5 cards proportional to `pricedCaptured`, residual on last so sum is exact. Used by reveal route + backfill migration. |

### Market prices
| File | Purpose |
|------|---------|
| `pricing.ts` | `fetchSetPrices(setCode)` (pokemontcg.io), `refreshAllCards({ jitter })` orchestrator, `buildChanges` pure diff, `getCachedPrice(cardId)` cache-through read, `invalidatePriceCache` (SCAN + UNLINK). |

### Marketplace
| File | Purpose |
|------|---------|
| `marketplace-fee.ts` | `computeTradeFee(ask)` → 5% ceil-to-cent fee + sellerNet. |

### Admin dashboard
| File | Purpose |
|------|---------|
| `economics.ts` | `computeEconomics(window)` aggregates ledger + sales for the Revenue tab. `snapshotToCsv` exports as flat CSV. `windowSince` resolves `today/7d/30d/all`. |
| `admin-guard.ts` | Shared admin auth gate — `requireAdmin()` returns either `{ ok: true, userId }` or a 401/403 short-circuit response. |
| `alerts.ts` | Threshold constants + three pure evaluators (`evalMarginDrift`, `evalChiSquared`, `evalBotSpike`) returning null / yellow / red. `persistAlert` writes deduplicated rows to `admin_alerts`. |

### Tests
Tests live next to their subject as `*.test.ts`. Run with `pnpm test` (or `pnpm test:watch`). 105 cases across 17 files.

## Rules for new files

- **Server-only.** Shared types go to `packages/shared`.
- **Throw on env problems.** Missing `JWT_SECRET`, `REDIS_URL`, `DATABASE_URL` must crash on first call.
- **Money via `decimal.js`** — never `Number()` or `parseFloat`.
- **Pure where possible.** Anything that can be written without IO gets a unit test.
