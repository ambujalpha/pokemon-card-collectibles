# apps/web/src/app/me/packs

User's owned packs. Phase 1 scope: list unopened packs. Phase 2 adds reveal.

## Files

- `page.tsx` — server component. Reads current user from JWT, queries `userPack` joined to `drop` for pack tier, renders a list. Reveal button is present but disabled with a "Phase 2" tooltip.

## API companion

`GET /api/me/packs` lives at `apps/web/src/app/api/me/packs/route.ts`. Returns `{ packs: [{id, dropId, purchasedAt, isRevealed, packTier}] }`. Phase 1 has no consumer of this endpoint other than as a future-proofing hook — the page reads Prisma directly for freshness.

## Phase 2 dependency

The disabled Reveal button stays disabled until Phase 2 ships:

- a reveal route (`POST /api/me/packs/:id/reveal`) that flips `isRevealed` and returns the `PackCard`s in rarity-ascending order,
- a `/me/packs/:id/reveal` page that animates the reveal in order (commons first, rares last) per the gist.

The data needed for the reveal is already in the DB at purchase time — `pack_cards` rows are populated in the purchase transaction. Phase 2 is pure UI + one route handler.

## User flow for this folder

1. User buys a pack from `/drops/[id]` → is redirected here.
2. Sees a new row at the top of the list: tier badge, purchase timestamp, disabled "Reveal (Phase 2)" button.
3. Can navigate back to `/drops` via the header.

The empty state (no packs) links back to `/drops`.
