import { PrismaClient } from "@prisma/client";

// Inspect: active weights, bucket means, recent reveal P&L.

const prisma = new PrismaClient();

async function main() {
  console.log("\n=== Active pack_weight_versions ===");
  const active = await prisma.packWeightVersion.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  for (const v of active) {
    console.log(
      `${v.tier}: ev=$${v.evPerPackUsd} target=${v.targetMargin} realised=${v.realisedMargin} binding=${v.constraintBinding} created=${v.createdAt.toISOString()}`,
    );
    console.log(`  weights: ${JSON.stringify(v.weightsJson)}`);
  }

  console.log("\n=== Current bucket means (latest snapshot OR base_price fallback) ===");
  const means = await prisma.$queryRaw<Array<{
    bucket: string; mean_price: string; min_price: string; max_price: string; cnt: bigint;
  }>>`
    WITH latest AS (
      SELECT DISTINCT ON (card_id) card_id, price FROM price_snapshots
      ORDER BY card_id, refreshed_at DESC
    )
    SELECT c.rarity_bucket::text AS bucket,
           AVG(COALESCE(l.price, c.base_price))::text AS mean_price,
           MIN(COALESCE(l.price, c.base_price))::text AS min_price,
           MAX(COALESCE(l.price, c.base_price))::text AS max_price,
           COUNT(*)::bigint AS cnt
    FROM cards c
    LEFT JOIN latest l ON l.card_id = c.id
    GROUP BY c.rarity_bucket
    ORDER BY c.rarity_bucket
  `;
  for (const r of means) {
    console.log(`${r.bucket.padEnd(10)} cnt=${r.cnt}  mean=$${Number(r.mean_price).toFixed(4)}  range=[$${Number(r.min_price).toFixed(2)}–$${Number(r.max_price).toFixed(2)}]`);
  }

  console.log("\n=== Last 5 revealed packs P&L ===");
  const packs = await prisma.$queryRaw<Array<{
    user_pack_id: string; tier: string; weight_version_id: string | null;
    cards_summed: string; tier_price: string; constraint_binding: string | null;
  }>>`
    SELECT up.id::text AS user_pack_id,
           d.pack_tier::text AS tier,
           up.weight_version_id::text AS weight_version_id,
           COALESCE(SUM(pc.priced_captured), 0)::text AS cards_summed,
           CASE d.pack_tier
             WHEN 'STARTER' THEN '5'
             WHEN 'PREMIUM' THEN '20'
             WHEN 'ULTRA'   THEN '50'
           END AS tier_price,
           pwv.constraint_binding
    FROM user_packs up
    JOIN drops d ON d.id = up.drop_id
    LEFT JOIN pack_cards pc ON pc.user_pack_id = up.id
    LEFT JOIN pack_weight_versions pwv ON pwv.id = up.weight_version_id
    WHERE up.is_revealed = true
    GROUP BY up.id, d.pack_tier, up.weight_version_id, up.purchased_at, pwv.constraint_binding
    ORDER BY up.purchased_at DESC
    LIMIT 5
  `;
  for (const p of packs) {
    const value = Number(p.cards_summed);
    const price = Number(p.tier_price);
    const margin = ((price - value) / price * 100).toFixed(1);
    console.log(`${p.tier.padEnd(8)} paid=$${price.toFixed(2)}  cards=$${value.toFixed(4)}  margin=${margin}%  binding=${p.constraint_binding ?? "—"}  v=${p.weight_version_id?.slice(0, 8) ?? "static"}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
