const TIMEOUT_MS = 1000;

// Fire-and-forget broadcast to the WS service via internal HTTP. Called after
// commit in mutation endpoints so failures on the WS hop never undo the DB
// transaction. Missing env vars degrade silently so local dev can run without
// the ws process up.
export async function emitToRoom(
  room: string,
  event: string,
  payload: unknown,
): Promise<void> {
  const url = process.env.WS_INTERNAL_URL;
  const secret = process.env.WS_INTERNAL_SECRET;
  if (!url || !secret) return;

  try {
    await fetch(`${url}/internal/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": secret,
      },
      body: JSON.stringify({ room, event, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.warn("ws-emit failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}
