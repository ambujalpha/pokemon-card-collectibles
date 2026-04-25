import { Rarity } from "@prisma/client";

import { prisma } from "@/lib/db";

import type { BucketMeans } from "./solver";

// Fetch the current mean card price per rarity bucket from the *latest* price
// snapshot per card (`price_snapshots` — one row per card per refresh).
// Cards that have never been priced fall back to their basePrice.
//
// Returns the bucket means plus the timestamp of the most recent snapshot
// used (for the weight-version audit trail).

export interface BucketMeansSnapshot {
  meansUsd: BucketMeans;
  latestRefreshedAt: Date;
  cardsByBucket: Record<Rarity, number>;
}

export async function loadBucketMeans(): Promise<BucketMeansSnapshot> {
  const rows = await prisma.$queryRaw<
    Array<{ rarity_bucket: Rarity; mean_price: string; latest: Date; cnt: bigint }>
  >`
    WITH latest AS (
      SELECT DISTINCT ON (card_id) card_id, price, refreshed_at
      FROM price_snapshots
      ORDER BY card_id, refreshed_at DESC
    )
    SELECT c.rarity_bucket::text AS rarity_bucket,
           AVG(COALESCE(l.price, c.base_price))::text AS mean_price,
           MAX(l.refreshed_at) AS latest,
           COUNT(*)::bigint AS cnt
    FROM cards c
    LEFT JOIN latest l ON l.card_id = c.id
    GROUP BY c.rarity_bucket
  `;

  const means: Partial<BucketMeans> = {};
  const cardsByBucket: Partial<Record<Rarity, number>> = {};
  let latestRefreshedAt = new Date(0);

  for (const row of rows) {
    const bucket = row.rarity_bucket as Rarity;
    means[bucket] = Number(row.mean_price);
    cardsByBucket[bucket] = Number(row.cnt);
    if (row.latest && row.latest > latestRefreshedAt) latestRefreshedAt = row.latest;
  }

  for (const b of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as Rarity[]) {
    if (means[b] === undefined) {
      const msg = `no cards in bucket ${b} — cannot solve weights`;
      throw new Error(msg);
    }
    if (cardsByBucket[b] === undefined) cardsByBucket[b] = 0;
  }

  return {
    meansUsd: means as BucketMeans,
    latestRefreshedAt,
    cardsByBucket: cardsByBucket as Record<Rarity, number>,
  };
}
