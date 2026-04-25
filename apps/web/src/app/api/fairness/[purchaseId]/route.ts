import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { TIER_PITY, type TierName } from "@/lib/rarity-weights";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FairnessRow {
  user_pack_id: string;
  server_seed_hash: string;
  server_seed: string | null;
  client_seed: string;
  nonce: string;
  weight_version_id: string | null;
  committed_at: Date;
  revealed_at: Date | null;
  weights_json: unknown;
  pack_tier: string;
}

// GET /api/fairness/:purchaseId
//
// Public — anyone can verify any pack's fairness record. Pre-reveal only the
// commit hash is returned; the server seed is exposed only after the user
// has revealed the pack.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ purchaseId: string }> },
) {
  const { purchaseId } = await params;
  if (!UUID_RE.test(purchaseId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<FairnessRow[]>`
    SELECT pf.user_pack_id, pf.server_seed_hash, pf.server_seed,
           pf.client_seed, pf.nonce, pf.weight_version_id,
           pf.committed_at, pf.revealed_at,
           pwv.weights_json,
           d.pack_tier::text AS pack_tier
    FROM pack_fairness pf
    LEFT JOIN pack_weight_versions pwv ON pwv.id = pf.weight_version_id
    JOIN user_packs up ON up.id = pf.user_pack_id
    JOIN drops d ON d.id = up.drop_id
    WHERE pf.user_pack_id = ${purchaseId}::uuid
    LIMIT 1
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const r = rows[0]!;
  const revealed = r.revealed_at !== null;
  const pity = TIER_PITY[r.pack_tier as TierName] ?? "NONE";

  return NextResponse.json({
    purchaseId: r.user_pack_id,
    tier: r.pack_tier,
    pity,
    serverSeedHash: r.server_seed_hash,
    serverSeed: revealed ? r.server_seed : null,
    clientSeed: r.client_seed,
    nonce: r.nonce,
    weightVersionId: r.weight_version_id,
    weights: revealed ? r.weights_json : null,
    committedAt: r.committed_at.toISOString(),
    revealedAt: r.revealed_at?.toISOString() ?? null,
  });
}
