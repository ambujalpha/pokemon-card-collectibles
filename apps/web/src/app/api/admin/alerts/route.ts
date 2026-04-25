import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-guard";
import { ALERT_THRESHOLDS } from "@/lib/alerts";
import { prisma } from "@/lib/db";

interface AlertRow {
  id: string;
  kind: string;
  severity: string;
  message: string;
  detail_json: unknown;
  created_at: Date;
  acknowledged_at: Date | null;
}

// GET /api/admin/alerts?include=ack — list alerts, newest first.
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;
  const url = new URL(request.url);
  const includeAck = url.searchParams.get("include") === "ack";
  const where = includeAck
    ? Prisma.sql`TRUE`
    : Prisma.sql`acknowledged_at IS NULL`;

  const rows = await prisma.$queryRaw<AlertRow[]>`
    SELECT id, kind, severity, message, detail_json, created_at, acknowledged_at
    FROM admin_alerts
    WHERE ${where}
    ORDER BY created_at DESC LIMIT 200
  `;

  return NextResponse.json({
    thresholds: ALERT_THRESHOLDS,
    alerts: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      message: r.message,
      detail: r.detail_json,
      createdAt: r.created_at.toISOString(),
      acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
    })),
  });
}
