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

export interface ListingEventPayload {
  listingId: string;
  event: "created" | "sold" | "cancelled";
}

// Subscribes to the global `listings` room — any create/sold/cancel broadcast
// lands here. Consumers typically refetch their local data on any event
// rather than diffing payloads (v1 has no per-user rooms).
export function subscribeToListingUpdates(
  onEvent: (payload: ListingEventPayload) => void,
): () => void {
  const s = getSocket();
  if (!s) return () => {};

  const join = () => s.emit("join", { room: "listings" });
  join();
  s.on("connect", join);

  const handler = (payload: ListingEventPayload) => onEvent(payload);
  s.on("listing_event", handler);

  return () => {
    s.off("listing_event", handler);
    s.off("connect", join);
    s.emit("leave", { room: "listings" });
  };
}

export interface AuctionEventPayload {
  auctionId: string;
  event: "created" | "cancelled" | "closed";
}

// Global `auctions` room — any create/cancel/close. Browsers on /auctions
// refetch on any event. Per-auction detail subscriptions (live bid stream)
// go through subscribeToAuctionRoom below.
export function subscribeToAuctionEvents(
  onEvent: (payload: AuctionEventPayload) => void,
): () => void {
  const s = getSocket();
  if (!s) return () => {};
  const join = () => s.emit("join", { room: "auctions" });
  join();
  s.on("connect", join);
  const handler = (payload: AuctionEventPayload) => onEvent(payload);
  s.on("auction_event", handler);
  return () => {
    s.off("auction_event", handler);
    s.off("connect", join);
    s.emit("leave", { room: "auctions" });
  };
}

export interface BidPlacedPayload {
  auctionId: string;
  amount: string;
  bidderId: string;
  closesAt: string;
  extensions: number;
}

export interface AuctionClosedPayload {
  auctionId: string;
  winnerId: string | null;
  finalBid: string | null;
}

// Per-auction room for live bid + close events. `onBid` fires on each bid_placed;
// `onClosed` fires once when the settlement lands.
export function subscribeToAuctionRoom(
  auctionId: string,
  handlers: {
    onBid?: (p: BidPlacedPayload) => void;
    onClosed?: (p: AuctionClosedPayload) => void;
  },
): () => void {
  const s = getSocket();
  if (!s) return () => {};
  const join = () => s.emit("join", { auctionId });
  join();
  s.on("connect", join);

  const onBid = (p: BidPlacedPayload) => {
    if (p.auctionId === auctionId) handlers.onBid?.(p);
  };
  const onClosed = (p: AuctionClosedPayload) => {
    if (p.auctionId === auctionId) handlers.onClosed?.(p);
  };
  s.on("bid_placed", onBid);
  s.on("auction_closed", onClosed);

  return () => {
    s.off("bid_placed", onBid);
    s.off("auction_closed", onClosed);
    s.off("connect", join);
    s.emit("leave", { auctionId });
  };
}
