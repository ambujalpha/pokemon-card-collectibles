# apps/ws

**Status:** placeholder until Phase 6.

This will be the separate Node process that:

- Holds long-lived WebSocket connections for `/auctions/:id` and `/collection`.
- Runs the daily price-refresh cron (Phase 3).
- Runs the per-second auction close worker (Phase 6).
- Subscribes to Upstash Redis pub/sub channels and fans out to socket rooms.

Deploys to Railway. Shares `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET` with `apps/web`.

See `/docs/architecture/HLD.md` §8 and ADR-8 for why this is a separate process, and §7.5 + ADR-9 for the close-worker design.
