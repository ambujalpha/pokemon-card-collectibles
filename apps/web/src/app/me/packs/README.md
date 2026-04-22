# apps/web/src/app/me/packs

User's owned packs — the single home for pack history. Phase 2 adds the Opened tab.

## Files

- `page.tsx` — server component. Reads the current user from JWT, resolves `?tab=unopened|opened` (default `unopened`), queries `userPack` filtered by `isRevealed`, renders the list with a tab strip. Unopened rows link to `/packs/[id]/reveal` (animate mode); Opened rows link to `/packs/[id]/reveal?mode=static`.

## API companion

`GET /api/me/packs` lives at `apps/web/src/app/api/me/packs/route.ts`. Accepts `?revealed=false|true|all`, defaults to `false` for backwards compatibility with Phase 1 callers. Returns `{packs: [{id, dropId, purchasedAt, isRevealed, packTier}]}`. The page reads Prisma directly for freshness; the API route exists for external / future clients.

## Tabs

| Tab | Filter | CTA per row | Routes to |
|---|---|---|---|
| Unopened (default) | `isRevealed = false` | Reveal | `/packs/:id/reveal` (animate) |
| Opened | `isRevealed = true` | View contents | `/packs/:id/reveal?mode=static` |

Each tab has its own empty state. The Unopened empty state links to `/drops`; the Opened empty state links to the Unopened tab.

## Why tabs instead of a single flat list

- Reviewers and users can find "my history" with one click.
- Keeps pack lifecycle discoverable on one route instead of requiring a separate `/me/opened` page.
- Collection view (Phase 4) will be the forever home for individual revealed *cards*. Opened packs are still a useful concept — you may want to revisit the ceremony of a specific pull.

## User flow for this folder

1. User buys a pack at `/drops/[id]` → redirected to `/me/packs?tab=unopened` (default).
2. Sees a new row at top: tier badge, purchase timestamp, **Reveal** button.
3. Click Reveal → `/packs/[id]/reveal` (animate mode) → ceremony plays → Back to My packs.
4. Returns to `/me/packs?tab=opened` → the pack has moved tabs.
5. Click **View contents** on any opened row → `/packs/[id]/reveal?mode=static` — static view of the same 5 cards, no animation.
