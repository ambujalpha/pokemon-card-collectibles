# @pullvault/shared

Types shared between `apps/web` and `apps/ws`. Keep this tiny — anything that only one app uses belongs in that app's `src/lib`.

**Current contents:** just `APP_NAME` and a `UUID` alias. Intended to grow with WebSocket event payloads, shared domain enums, and pricing types.

**Consumed as:** a pnpm workspace dep. Add to a consumer with `pnpm add @pullvault/shared --workspace`. Import paths stay TS source (no build step) — pnpm workspaces resolve the `main` field directly.
