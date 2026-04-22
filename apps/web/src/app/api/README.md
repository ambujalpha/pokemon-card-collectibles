# apps/web/src/app/api

All HTTP endpoints for PullVault. Each `route.ts` becomes an endpoint at its folder path.

## Routes

### Auth + user (Phase 0)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/signup` | Create user, bcrypt-12 password hash, set JWT cookie. |
| POST | `/api/auth/login` | Verify password (1s delay on failure), set JWT cookie. |
| POST | `/api/auth/logout` | Clear JWT cookie. |
| GET  | `/api/me` | Return current user (fresh from DB — JWT has no balance). |
| POST | `/api/funds/add` | Credit a positive amount after 2–5s delay; ledger row `FUND_DEPOSIT`. |

### Drops + packs (Phase 1+2)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/drops` | List all drops with derived status. |
| GET | `/api/drops/[id]` | Drop detail + remaining. |
| POST | `/api/drops/[id]/purchase` | Atomic purchase: `SELECT FOR UPDATE` on drop, balance check, decrement remaining, generate 10 pack_cards, ledger `PACK_PURCHASE`. Emits `inventory_update` on `drop:<id>`. |
| POST | `/api/packs/[id]/reveal` | Atomic reveal: `SELECT FOR UPDATE` on user_pack, flip isRevealed, generate user_cards rows with ratio-allocated acquiredPrice. |
| GET  | `/api/packs/[id]/contents` | Revisit-only. 409 until revealed. Used by `?mode=static` reveal pages. |
| GET  | `/api/me/packs` | Owned packs with `?revealed=true|false|all`. |

### Market prices (Phase 3) — see [`admin/prices/README.md`](./admin/prices/README.md) for detail
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/prices/refresh` | Admin only. Fetches pokemontcg.io, bulk updates `cards.basePrice` + writes `price_snapshots`, invalidates Redis, broadcasts `prices_refreshed` on `prices` room. Mutex + 5s rate limit + optional demo `?jitter=0.05`. |

### Collection (Phase 4)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/collection` | Current user's cards (HELD + LISTED), server-computed aggregates (spent/current/P&L), sort + rarity filter. |

### Marketplace (Phase 5)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/listings` | Create listing. Card must be HELD. Flips `user_cards.status = LISTED`. |
| GET | `/api/listings` | Browse ACTIVE (excludes own by default; `?mine=1` to include). |
| GET | `/api/listings/[id]` | Listing detail. |
| DELETE | `/api/listings/[id]` | Seller cancel (ACTIVE → CANCELLED, card back to HELD). |
| POST | `/api/listings/[id]/purchase` | Atomic trade. `SELECT FOR UPDATE` on listing, id-sorted lock on (buyer, seller), 3 ledger rows (TRADE_BUY / TRADE_SELL / TRADE_FEE). |

### Auctions (Phase 6)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auctions` | Create auction (duration `2m/5m/10m`). Card HELD → AUCTION. |
| GET | `/api/auctions` | Browse LIVE or CLOSED with sort + rarity filter. |
| GET | `/api/auctions/[id]` | Detail + last 50 bids + seller/winner emails. |
| DELETE | `/api/auctions/[id]` | Seller cancel (only if LIVE + zero bids). |
| POST | `/api/auctions/[id]/bid` | Atomic bid: FOR UPDATE on auction, id-sorted lock on (bidder, prev bidder), balance check, BID_HOLD + optional BID_RELEASE for previous bidder, anti-snipe extension, append to `bids`, update denormalised high. |
| POST | `/api/internal/auctions/settle-due` | **Internal** (`X-Internal-Secret`). Called by `apps/ws` close worker every 1s. `SELECT FOR UPDATE SKIP LOCKED` up to 20 due auctions, settles each in its own tx, broadcasts `auction_closed`. |

### Admin dashboard (Phase 7)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/economics` | Aggregated platform metrics. Query: `window=today|7d|30d|all`, `format=json|csv`, `fresh=1`. 5-min process-local cache. |

## Route conventions

- **Validate inputs.** UUIDs via regex; money via `parseMoney`; body shape via hand-rolled checks (consistency with Phase 1 decision to skip `zod` on hot paths).
- **Atomic mutations** wrap the work in `prisma.$transaction` with `ReadCommitted` isolation. WS broadcasts happen **after** commit.
- **Cross-user locks in id-sorted order** to avoid deadlock. Every route that locks two user rows does `ORDER BY id FOR UPDATE`.
- **401 vs 403** — no cookie / bad cookie → 401. Has session but not permitted (non-admin on admin route) → 403.
- **Money responses** always return 4-decimal strings, never numbers.
- **No inline comments** summarising what routes do — this README is the map.
