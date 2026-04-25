import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";

// GET /api/admin/economics/fraud
//
// Powers the `Fraud` tab. Surfaces:
//   - rate-limit hit count over the last 24h (best-effort: counts user_risk
//     rows updated recently with rapid-purchase signal as a proxy)
//   - flagged accounts count + top risk scores
//   - account-link clusters with ≥3 distinct user_ids
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;

  const [riskRows, topRiskRows, clusterRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      flagged: bigint; updated_24h: bigint;
    }>>`
      SELECT
        COUNT(*) FILTER (WHERE flagged = true)::bigint AS flagged,
        COUNT(*) FILTER (WHERE last_updated >= NOW() - INTERVAL '24 hours')::bigint AS updated_24h
      FROM user_risk
    `,
    prisma.$queryRaw<Array<{
      user_id: string; email: string; score: number;
      flagged: boolean; last_updated: Date;
    }>>`
      SELECT ur.user_id, u.email, ur.score, ur.flagged, ur.last_updated
      FROM user_risk ur JOIN users u ON u.id = ur.user_id
      ORDER BY ur.score DESC LIMIT 10
    `,
    prisma.$queryRaw<Array<{
      ip: string; user_agent_hash: string; users: bigint;
    }>>`
      SELECT ip, user_agent_hash, COUNT(DISTINCT user_id)::bigint AS users
      FROM account_links
      WHERE last_seen >= NOW() - INTERVAL '24 hours'
      GROUP BY ip, user_agent_hash
      HAVING COUNT(DISTINCT user_id) >= 3
      ORDER BY users DESC LIMIT 25
    `,
  ]);

  const summary = riskRows[0] ?? { flagged: BigInt(0), updated_24h: BigInt(0) };

  return NextResponse.json({
    flaggedAccounts: Number(summary.flagged),
    riskUpdated24h: Number(summary.updated_24h),
    topRisk: topRiskRows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      score: r.score,
      flagged: r.flagged,
      lastUpdated: r.last_updated.toISOString(),
    })),
    accountLinkClusters: clusterRows.map((r) => ({
      ip: r.ip,
      userAgentHash: r.user_agent_hash,
      users: Number(r.users),
    })),
  });
}
