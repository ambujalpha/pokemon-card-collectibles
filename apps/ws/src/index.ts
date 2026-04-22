import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import { makeBroadcastHandler } from "./internal/broadcast.js";

// Load .env at startup. Next.js auto-loads env for apps/web, but `tsx watch`
// does not — without this, WS_INTERNAL_SECRET etc. would be undefined in dev.
// In prod (Railway) the file doesn't exist; env comes from the platform and
// the ENOENT gets swallowed. Requires Node 20.12+ (repo engines: node >=20).
try {
  process.loadEnvFile();
} catch {
  // No .env file at CWD — fine in prod where env is injected by the platform.
}

const PORT = Number(process.env.PORT ?? 3001);
const INTERNAL_SECRET = process.env.WS_INTERNAL_SECRET ?? "";
if (!INTERNAL_SECRET || INTERNAL_SECRET.length < 16) {
  console.error("WS_INTERNAL_SECRET missing or too short (need ≥16 chars)");
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const server = createServer(handleHttp);
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: false },
});
const handleBroadcast = makeBroadcastHandler(io, INTERNAL_SECRET);

// Rooms allow-listed for generic client subscription. `drop:*` rooms are
// handled through the dropId-specific branch because the UUID is user-supplied.
const ALLOWED_ROOMS = new Set(["prices", "listings"]);

io.on("connection", (socket) => {
  socket.on("join", (data: { dropId?: string; room?: string }) => {
    if (typeof data?.dropId === "string" && UUID_RE.test(data.dropId)) {
      socket.join(`drop:${data.dropId}`);
      return;
    }
    if (typeof data?.room === "string" && ALLOWED_ROOMS.has(data.room)) {
      socket.join(data.room);
    }
  });
  socket.on("leave", (data: { dropId?: string; room?: string }) => {
    if (typeof data?.dropId === "string" && UUID_RE.test(data.dropId)) {
      socket.leave(`drop:${data.dropId}`);
      return;
    }
    if (typeof data?.room === "string" && ALLOWED_ROOMS.has(data.room)) {
      socket.leave(data.room);
    }
  });
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  if (req.url?.startsWith("/socket.io")) return;

  if (req.method === "POST" && req.url === "/internal/broadcast") {
    handleBroadcast(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, service: "pullvault-ws" }));
    return;
  }
  res.statusCode = 404;
  res.end();
}

server.listen(PORT, () => {
  console.log(`ws listening on :${PORT}`);
});
