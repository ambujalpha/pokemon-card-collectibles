import { DropStatus } from "@prisma/client";

// The stored Drop.status column is a denormalised cache. The authoritative
// status is derived from `now` vs `startsAt/endsAt` and `remaining`, recomputed
// on every read so clock drift or a missed opportunistic update can never
// produce a purchase that shouldn't have been allowed.
export function deriveStatus(drop: {
  startsAt: Date;
  endsAt: Date;
  remaining: number;
}): DropStatus {
  if (drop.remaining <= 0) return "SOLD_OUT";
  const now = new Date();
  if (now < drop.startsAt) return "SCHEDULED";
  if (now >= drop.endsAt) return "ENDED";
  return "LIVE";
}
