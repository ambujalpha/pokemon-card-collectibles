# apps/web/src/components

Client + server React components. Client components carry `"use client"` at the top; everything else is a server component by default.

## Files

### Auth + dashboard
| File | Kind | Used by |
|------|------|---------|
| `signup-form.tsx` | client | `app/signup/page.tsx` |
| `login-form.tsx` | client | `app/login/page.tsx` |
| `logout-button.tsx` | client | `app-header.tsx` |
| `add-funds-button.tsx` | client | `app/page.tsx` (dashboard) |

### Shared chrome
| File | Kind | Used by |
|------|------|---------|
| `app-header.tsx` | server | every authenticated page (`/`, `/drops`, `/collection`, `/market`, `/auctions`, `/me/*`, `/admin/economics`). Shows nav, balance, admin surfaces. |
| `admin-refresh-button.tsx` | client | `app-header.tsx` (admin only). Fires `POST /api/admin/prices/refresh` with optional demo-jitter toggle. |

### Drops
| File | Kind | Used by |
|------|------|---------|
| `drops-list.tsx` | server | `app/drops/page.tsx` — grid of all drops. |
| `drop-detail.tsx` | client | `app/drops/[id]/page.tsx` — inventory, countdown, purchase modal, subscribes to `drop:<id>` WS room. |
| `drop-countdown.tsx` | client | `drop-detail.tsx` — per-second countdown to `startsAt` / `endsAt`. |
| `confirm-purchase-modal.tsx` | client | `drop-detail.tsx` — buy-confirmation, calls `/api/drops/:id/purchase`. |

### Pack reveal
| File | Kind | Used by |
|------|------|---------|
| `reveal-flow.tsx` | client | `app/packs/[id]/reveal/page.tsx`. Runs the animate / static state machine, CSS 3D card flips, Skip + Summary; subscribes to `prices` room for live re-valuation. |

### Collection + marketplace
| File | Kind | Used by |
|------|------|---------|
| `collection-view.tsx` | client | `app/collection/page.tsx`. Grid of owned cards, sort/filter, aggregate tiles, auto-refetch on WS events. |
| `sell-form.tsx` | client | `app/sell/[userCardId]/page.tsx`. Fixed-price / Auction tabs, duration picker (2m/5m/10m), fee + premium preview. |
| `market-browse.tsx` | client | `app/market/page.tsx`. Listing grid, sort/filter, "Yours" badge, refetch on listing/price events. |
| `listing-detail.tsx` | client | `app/market/[id]/page.tsx`. Ask + market + premium, Buy / Cancel actions, 200%-over-market warning. |

### Auctions
| File | Kind | Used by |
|------|------|---------|
| `auctions-browse.tsx` | client | `app/auctions/page.tsx`. Live + Closed tabs, per-second countdown tick (shared via `nowTick` prop to tiles), sort by ending soonest. |
| `auction-detail.tsx` | client | `app/auctions/[id]/page.tsx`. Live countdown, bid form with client-side min hint (server authoritative), bid history, "you won" banner on close, cancel button when no bids. |

### Admin
| File | Kind | Used by |
|------|------|---------|
| `economics-dashboard.tsx` | client | `app/admin/economics/page.tsx`. Window tabs (today/7d/30d/all), Refresh, CSV download, platform summary + per-tier pack table + marketplace/auction cards + top spenders. |

## Conventions

- **Prefer server components** for anything that reads from the DB. Client components are for interactivity only.
- **After a mutation**, call `router.refresh()` or refetch — don't mutate local state optimistically.
- **WS subscriptions** always return a cleanup function from the subscribe helper. Use it in the effect's return.
- **Keep components under ~300 lines.** Split into smaller components rather than growing one file.
- **No comments describing what a component does** — this README is the map. File-level docstrings are fine for non-obvious invariants.
