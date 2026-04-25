# apps/web/src/app/api

All HTTP endpoints for PullVault. Each `route.ts` becomes an endpoint at its folder path.

## Routes

### Auth + user
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/signup` | Create user, bcrypt-12 password hash, set JWT cookie. |
| POST | `/api/auth/login` | Verify password (1s delay on failure), set JWT cookie. |
| POST | `/api/auth/logout` | Clear JWT cookie. |
| GET  | `/api/me` | Return current user (fresh from DB — JWT has no balance). |
| POST | `/api/funds/add` | Credit a positive amount after 2–5s delay; ledger row `FUND_DEPOSIT`. |

### Drops + packs
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/drops` | List all drops with derived status. |
| GET | `/api/drops/[id]` | Drop detail + remaining. |
| POST | `/api/drops/[id]/purchase` | Atomic purchase: per-user rate-limit (6/min, 20/hr; fail-open) → 0–500 ms admission jitter → `SELECT FOR UPDATE` on drop → balance check → decrement remaining → deterministic seeded roll (active solver weights + tier pity floor) → write 5 `pack_cards` + a `pack_fairness` commit row → ledger `PACK_PURCHASE`. Emits `inventory_update` on `drop:<id>`. |
| POST | `/api/packs/[id]/reveal` | Atomic reveal: `SELECT FOR UPDATE` on user_pack, flip isRevealed, stamp `pack_fairness.revealed_at`, generate user_cards rows with ratio-allocated acquiredPrice. |
| GET  | `/api/packs/[id]/contents` | Revisit-only. 409 until revealed. Used by `?mode=static` reveal pages. |
| GET  | `/api/me/packs` | Owned packs with `?revealed=true|false|all`. |
| GET  | `/api/cards/pool` | Public canonical card pool sorted by id — input for the browser fairness verifier. |

### Market prices — see [`admin/prices/README.md`](./admin/prices/README.md) for detail
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/prices/refresh` | Admin only. Fetches pokemontcg.io, bulk updates `cards.basePrice` + writes `price_snapshots`, invalidates Redis, broadcasts `prices_refreshed` on `prices` room. Mutex + 5s rate limit + optional demo `?jitter=0.05`. |

### Collection
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/collection` | Current user's cards (HELD + LISTED), server-computed aggregates (spent/current/P&L), sort + rarity filter. |

### Marketplace
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/listings` | Create listing. Card must be HELD. Flips `user_cards.status = LISTED`. |
| GET | `/api/listings` | Browse ACTIVE (excludes own by default; `?mine=1` to include). |
| GET | `/api/listings/[id]` | Listing detail. |
| DELETE | `/api/listings/[id]` | Seller cancel (ACTIVE → CANCELLED, card back to HELD). |
| POST | `/api/listings/[id]/purchase` | Atomic trade. `SELECT FOR UPDATE` on listing, id-sorted lock on (buyer, seller), 3 ledger rows (TRADE_BUY / TRADE_SELL / TRADE_FEE). |

### Auctions
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auctions` | Create auction (duration `2m/5m/10m`). Card HELD → AUCTION. |
| GET | `/api/auctions` | Browse LIVE or CLOSED with sort + rarity filter. |
| GET | `/api/auctions/[id]` | Detail + last 50 bids + seller/winner emails. **Sealed final-minute window** redacts `currentBid`, `currentBidderId`, `bids[]`, `isLeading`; sets `sealed: true`. |
| DELETE | `/api/auctions/[id]` | Seller cancel (only if LIVE + zero bids). |
| POST | `/api/auctions/[id]/bid` | Atomic bid: 2 s same-user min-interval (Redis SET NX EX, fail-open on transport error) → FOR UPDATE on auction → first-bid validation (≥ `starting_bid`, ≤ 5× `starting_bid`) or increment validation (≥ `minNextBid`, ≤ 5× current high) → id-sorted lock on (bidder, prev bidder) → balance check → BID_HOLD + optional BID_RELEASE for previous bidder → anti-snipe extension → append to `bids` → update denormalised high. Inside the sealed final 60 s, suppresses `bid_placed`; emits `sealed_phase_started` once on entry. |
| POST | `/api/internal/auctions/settle-due` | **Internal** (`X-Internal-Secret`). Called by `apps/ws` close worker every 1s. `SELECT FOR UPDATE SKIP LOCKED` up to 20 due auctions, settles each in its own tx, broadcasts `auction_closed`, then runs wash-trade detection (writes to `auction_flags`) outside the tx. |

### Fairness (public)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/fairness/[purchaseId]` | Public commit/reveal record for a pack. Pre-reveal: hash + client seed + nonce. Post-reveal: also returns `serverSeed` and pinned `weights`. |
| GET | `/api/fairness/audit` | Per-tier chi-squared GOF over revealed packs (`?window=7d|30d|all`) against the active `pack_weight_versions` row. |

### Admin dashboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/economics` | Revenue snapshot. Query: `window=today|7d|30d|all`, `format=json|csv`, `fresh=1`. 5-min process-local cache. |
| POST | `/api/admin/economics/simulate` | Seeded Monte-Carlo simulation (`?tier=&n=&seed=`). Returns realised margin / win-rate / bucket hit rates against active weights, plus a `proposed` block from the solver. |
| POST | `/api/admin/economics/rebalance` | Re-solve all tiers (or `?tier=…`) from current bucket means. Atomically deactivates prior versions and inserts new active rows. 409 `solver_infeasible` with diagnostics on hard infeasibility. |
| GET | `/api/admin/economics/fraud` | Fraud tab payload — flagged-account count, top risk scores, account-link clusters with ≥ 3 users. |
| GET | `/api/admin/economics/health` | Per-tier realised vs target margin (last 7 d), active version metadata, `rebalanceSuggested` flag. Side-effect: writes `admin_alerts` rows on margin drift. |
| GET | `/api/admin/economics/users` | Users tab payload — total/active counts, auction participation, drop engagement, 7-d retention. |
| GET | `/api/admin/auctions/analytics` | Auction analytics (`?window=7d|30d|all`) — counts, snipe rate, flag counts, final-vs-market histogram. |
| GET | `/api/admin/alerts` | Newest 200 alerts (default unacknowledged only; `?include=ack` returns history) plus the threshold constants. |
| POST | `/api/admin/alerts/[id]/ack` | Acknowledge an alert; flips `acknowledged_at` and records the admin id. |

## Route conventions

- **Validate inputs.** UUIDs via regex; money via `parseMoney`; body shape via hand-rolled checks.
- **Atomic mutations** wrap the work in `prisma.$transaction` with `ReadCommitted` isolation. WS broadcasts happen **after** commit.
- **Cross-user locks in id-sorted order** to avoid deadlock. Every route that locks two user rows does `ORDER BY id FOR UPDATE`.
- **401 vs 403** — no cookie / bad cookie → 401. Has session but not permitted (non-admin on admin route) → 403.
- **Money responses** always return 4-decimal strings, never numbers.
- **No inline comments** summarising what routes do — this README is the map.
