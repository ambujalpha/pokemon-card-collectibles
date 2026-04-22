"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function getSocket(): Socket | null {
  if (socket) return socket;
  const url = process.env.NEXT_PUBLIC_WS_URL;
  if (!url) return null;
  socket = io(url, {
    transports: ["websocket"],
    autoConnect: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });
  return socket;
}

export interface InventoryUpdate {
  dropId: string;
  remaining: number;
}

// Subscribes to inventory updates for one drop room. Returns an unsubscribe
// function that leaves the room and detaches the listener. A no-op if
// NEXT_PUBLIC_WS_URL isn't configured (local dev with ws process down).
export function subscribeToDropInventory(
  dropId: string,
  onUpdate: (payload: InventoryUpdate) => void,
): () => void {
  const s = getSocket();
  if (!s) return () => {};

  const join = () => s.emit("join", { dropId });
  join();
  s.on("connect", join);

  const handler = (payload: InventoryUpdate) => {
    if (payload?.dropId === dropId) onUpdate(payload);
  };
  s.on("inventory_update", handler);

  return () => {
    s.off("inventory_update", handler);
    s.off("connect", join);
    s.emit("leave", { dropId });
  };
}

export interface PricesRefreshedPayload {
  refreshedAt: string;
  changes: Array<{ cardId: string; from: string; to: string }>;
}

// Subscribes to the global `prices` room. Fired whenever an admin triggers a
// price refresh. Returns an unsubscribe function. No-op without WS configured.
export function subscribeToPriceUpdates(
  onUpdate: (payload: PricesRefreshedPayload) => void,
): () => void {
  const s = getSocket();
  if (!s) return () => {};

  const join = () => s.emit("join", { room: "prices" });
  join();
  s.on("connect", join);

  const handler = (payload: PricesRefreshedPayload) => onUpdate(payload);
  s.on("prices_refreshed", handler);

  return () => {
    s.off("prices_refreshed", handler);
    s.off("connect", join);
    s.emit("leave", { room: "prices" });
  };
}
