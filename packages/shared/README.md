# @pullvault/shared

Types shared between `apps/web` and `apps/ws`. Keep this tiny — anything that only one app uses belongs in that app's `src/lib`.

**Current contents:** just `APP_NAME` and a `UUID` alias. Grows over time with WebSocket event payloads (Phase 6), shared domain enums, and pricing types.

**Consumed as:** a pnpm workspace dep. Add to a consumer with `pnpm add @pullvault/shared --workspace`. Import paths stay TS source (no build step) — pnpm workspaces resolve the `main` field directly.
