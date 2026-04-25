-- CreateTable
CREATE TABLE "auction_flags" (
    "id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "detail_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" UUID,

    CONSTRAINT "auction_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_fairness" (
    "user_pack_id" UUID NOT NULL,
    "server_seed_hash" TEXT NOT NULL,
    "server_seed" TEXT,
    "client_seed" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "weight_version_id" UUID,
    "committed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealed_at" TIMESTAMPTZ,

    CONSTRAINT "pack_fairness_pkey" PRIMARY KEY ("user_pack_id")
);

-- CreateTable
CREATE TABLE "fairness_audit_log" (
    "id" UUID NOT NULL,
    "pack_tier" "pack_tier_enum" NOT NULL,
    "rarity_bucket" "rarity_enum" NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "window_end" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fairness_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_flags_auction_id_idx" ON "auction_flags"("auction_id");

-- CreateIndex
CREATE INDEX "auction_flags_reviewed_at_idx" ON "auction_flags"("reviewed_at");

-- CreateIndex
CREATE INDEX "pack_fairness_revealed_at_idx" ON "pack_fairness"("revealed_at");

-- CreateIndex
CREATE INDEX "fairness_audit_log_pack_tier_window_end_idx" ON "fairness_audit_log"("pack_tier", "window_end");
