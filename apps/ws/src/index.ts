import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import { makeBroadcastHandler } from "./internal/broadcast.js";

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

io.on("connection", (socket) => {
  socket.on("join", (data: { dropId?: string }) => {
    if (typeof data?.dropId !== "string" || !UUID_RE.test(data.dropId)) return;
    socket.join(`drop:${data.dropId}`);
  });
  socket.on("leave", (data: { dropId?: string }) => {
    if (typeof data?.dropId !== "string" || !UUID_RE.test(data.dropId)) return;
    socket.leave(`drop:${data.dropId}`);
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
