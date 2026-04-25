-- CreateTable
CREATE TABLE "user_risk" (
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "signals_json" JSONB NOT NULL DEFAULT '{}',
    "last_updated" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_risk_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "account_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip" TEXT NOT NULL,
    "user_agent_hash" TEXT NOT NULL,
    "seen_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_risk_flagged_last_updated_idx" ON "user_risk"("flagged", "last_updated");

-- CreateIndex
CREATE INDEX "account_links_ip_user_agent_hash_idx" ON "account_links"("ip", "user_agent_hash");

-- CreateIndex
CREATE UNIQUE INDEX "account_links_user_id_ip_user_agent_hash_key" ON "account_links"("user_id", "ip", "user_agent_hash");
