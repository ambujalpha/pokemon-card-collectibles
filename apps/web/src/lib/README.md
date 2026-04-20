# apps/web/src/lib

Cross-cutting server-side utilities used by API routes and server components. Client components must not import from here directly (some files import `next/headers` / `@prisma/client` which are server-only).

| File        | Purpose                                                                                      |
|-------------|----------------------------------------------------------------------------------------------|
| `db.ts`     | Prisma client singleton. Cached on `globalThis` in dev to survive Next.js HMR restarts.       |
| `redis.ts`  | ioredis singleton pointed at Upstash via `REDIS_URL`. Same HMR-cache pattern as `db.ts`.      |
| `money.ts`  | `decimal.js` re-export + `parseMoney` / `formatMoney` / `MoneyParseError`. Mandated by HLD ADR-5 — never use floats for money. |
| `jwt.ts`    | HS256 access-token sign/verify. 24h TTL (HLD ADR-10). Cookie name exported as `ACCESS_TOKEN_COOKIE`. |
| `auth.ts`   | `getCurrentUser` / `requireCurrentUser` for route handlers and server components. Reads the cookie, verifies via `jwt.ts`. |

## Rules for files in this folder

- **Server-only.** Anything that must run on both sides lives in `packages/shared`.
- **No business logic.** Business logic lives in `src/lib/services/*` (added as phases need it). This folder is plumbing.
- **Throw, don't return null on env problems.** Missing `JWT_SECRET` / `REDIS_URL` must crash on first call, not silently produce broken behaviour.
