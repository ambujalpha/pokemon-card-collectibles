# apps/web/src/components

Client + server components. Client components carry `"use client"` at the top.

## Phase 0 components

| File                    | Kind   | Used by                     |
|-------------------------|--------|-----------------------------|
| `login-form.tsx`        | client | `app/login/page.tsx`        |
| `signup-form.tsx`       | client | `app/signup/page.tsx`       |
| `add-funds-button.tsx`  | client | `app/page.tsx` (dashboard)  |
| `logout-button.tsx`     | client | `app/page.tsx` (header)     |

## Conventions

- Prefer server components for anything that reads from the DB.
- Client components are only for interactivity (forms, modals, buttons that mutate).
- After a successful mutation, call `router.refresh()` so the server re-fetches data for the surrounding server component.
- No inline comments describing what a component does — the README here is the map.
