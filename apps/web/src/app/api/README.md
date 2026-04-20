# apps/web/src/app/api

All HTTP endpoints for PullVault live here as Next.js App Router route handlers. Every file named `route.ts` becomes an HTTP endpoint at the folder's path.

## Phase 0 routes

| Method | Path                  | What it does                                                                  |
|--------|-----------------------|-------------------------------------------------------------------------------|
| POST   | `/api/auth/signup`    | Create user, hash password (bcrypt 12), set JWT cookie, return user           |
| POST   | `/api/auth/login`     | Verify password; 1s delay on failure; set JWT cookie; return user             |
| POST   | `/api/auth/logout`    | Clear JWT cookie                                                              |
| GET    | `/api/me`             | Return current user (fresh from DB — JWT balance may be stale)                |
| POST   | `/api/funds/add`      | Credit any positive amount to user balance after 2–5s delay; write ledger row |

## Conventions for route files

- **Never end route paths in a trailing slash.** Next.js routes already follow this, but don't introduce one.
- **Validate input with `zod`.** No hand-rolled validation.
- **Money routes:** every amount goes through `parseMoney` from `@/lib/money` — never `Number()` or `parseFloat`.
- **Mutating routes:** wrapped in `prisma.$transaction`. Publishing to Redis pub/sub (added in later phases) must happen *after* commit.
- **401 vs 403:** no cookie / bad cookie → 401. Has session but not authorised (e.g. non-admin hitting admin) → 403.
- **No inline comments** explaining what routes do — this README is the map.
