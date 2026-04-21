import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server as SocketIOServer } from "socket.io";

const MAX_BODY_BYTES = 100_000;

export function makeBroadcastHandler(io: SocketIOServer, secret: string) {
  return function handleBroadcast(req: IncomingMessage, res: ServerResponse): void {
    const header = req.headers["x-internal-secret"];
    if (typeof header !== "string" || !secretsMatch(header, secret)) {
      res.statusCode = 401;
      res.end();
      return;
    }

    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        req.destroy();
      }
    });
    req.on("end", () => {
      let body: { room?: unknown; event?: unknown; payload?: unknown };
      try {
        body = JSON.parse(raw) as typeof body;
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }
      if (typeof body.room !== "string" || typeof body.event !== "string") {
        res.statusCode = 400;
        res.end();
        return;
      }
      io.to(body.room).emit(body.event, body.payload ?? {});
      res.statusCode = 204;
      res.end();
    });
  };
}

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
