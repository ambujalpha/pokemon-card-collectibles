import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/admin/alerts/:id/ack
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.res;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const updated = await prisma.$executeRaw`
    UPDATE admin_alerts
       SET acknowledged_at = NOW(), acknowledged_by = ${guard.userId}::uuid
     WHERE id = ${id}::uuid AND acknowledged_at IS NULL
  `;
  if (updated === 0) {
    return NextResponse.json({ error: "not_found_or_acked" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
