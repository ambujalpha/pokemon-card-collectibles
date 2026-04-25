-- CreateTable
CREATE TABLE "admin_alerts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ,
    "acknowledged_by" UUID,

    CONSTRAINT "admin_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_alerts_acknowledged_at_created_at_idx" ON "admin_alerts"("acknowledged_at", "created_at");

-- CreateIndex
CREATE INDEX "admin_alerts_kind_created_at_idx" ON "admin_alerts"("kind", "created_at");
