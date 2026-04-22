# apps/web/src/app/packs/[id]/reveal

Pack reveal page — the "open the pack" ceremony. Two modes on one route:

- **animate** (default): POSTs to `/api/packs/:id/reveal`, flips `isRevealed`, streams 5 card flips in rarity-ascending order with rarity-keyed pacing.
- **static** (`?mode=static`): GETs `/api/packs/:id/contents`, shows all 5 cards + summary instantly. Used by the Opened tab on `/me/packs` to revisit a pack.

## Files

- `page.tsx` — server component. Auth-guards, loads the current user for the header, hands off to the client flow.
- `../../../../components/reveal-flow.tsx` — client component. State machine (loading → animating → done) plus the flip-stack and summary panel.

## API companion

Two endpoints, in `apps/web/src/app/api/packs/[id]/`:

- `POST /reveal` — single atomic mutation. `SELECT ... FOR UPDATE` on the `user_packs` row, flips `is_revealed = true`, returns `{pack, cards}` sorted `(rarity ASC, position ASC)`. Two concurrent tabs: second blocks, then returns 409 `already_revealed`.
- `GET /contents` — revisit-only. Returns the same shape as POST /reveal but **only** if `is_revealed = true`; else 409 `not_yet_revealed`.

The contents endpoint never reveals a pack — the POST does. A user cannot see their cards by hitting the GET directly without first committing the reveal via POST.

## Why a single mutation (and not a "Continue button commits")

The reveal flag flips as part of the fetch. Rationale:

- **Concurrency is clean.** `SELECT ... FOR UPDATE` serialises two tabs; exactly one gets cards, the other 409s.
- **No state can be observed without a commit.** There's no window where the user has the cards in-memory but the DB still says unrevealed.
- **Reload behaviour is simple.** Reloading mid-animation just shows the static result — no half-revealed state.

Trade-off: a user who loses connection between click and response sees a spinner with no cards to animate. We retry via reload; the pack is already revealed, so static mode takes over.

## Animation pacing

Constants live in `apps/web/src/lib/reveal-pacing.ts`:

| Rarity | Flip duration |
|---|---|
| Common | 600 ms |
| Uncommon | 800 ms |
| Rare | 1200 ms |
| Epic | 1800 ms |
| Legendary | 2500 ms |

Plus a 100ms gap between cards. Starter pack ~4s total, Ultra pack ~8s. Skip button jumps straight to summary with no effect on the commit state (it was already flipped at POST time).

## Pricing columns

Each card shows **At pull** (`PackCard.pricedCaptured`, frozen at purchase) and **Now** (`Card.basePrice`, current). Summary panel shows both P&L views:

- At-pull P&L = Σ(pricedCaptured) − tier price
- Current P&L = Σ(basePrice) − tier price

In **static mode** the page subscribes to the WS `prices` room and on `prices_refreshed` events re-fetches contents, flashes any changed tile (green up / red down for 800ms), and updates the per-tile "as of HH:MM UTC" timestamp. The Current-value summary recomputes against the new prices. Animate mode does not subscribe — the WS connection only matters once the cards are visible.

## User flow for this folder

1. User clicks **Reveal** on the Unopened tab of `/me/packs` → lands here in animate mode.
2. Client POSTs `/api/packs/:id/reveal`; on 200, `is_revealed = true` in the DB and cards are in memory.
3. Cards flip sequentially, rarity-ascending. Skip button available from card 1.
4. On completion (or Skip) → summary panel renders with both P&L views.
5. Click **Back to My packs** → lands on `/me/packs?tab=opened` → the pack is now in the Opened tab.
6. User clicks **View contents** on the Opened tab → back here in static mode (`?mode=static`); no animation, contents shown instantly.
