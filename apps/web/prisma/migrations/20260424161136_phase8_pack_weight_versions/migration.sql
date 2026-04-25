-- AlterTable
ALTER TABLE "user_packs" ADD COLUMN     "weight_version_id" UUID;

-- CreateTable
CREATE TABLE "pack_weight_versions" (
    "id" UUID NOT NULL,
    "tier" "pack_tier_enum" NOT NULL,
    "weights_json" JSONB NOT NULL,
    "solved_for_prices_at" TIMESTAMPTZ NOT NULL,
    "ev_per_pack_usd" DECIMAL(18,4) NOT NULL,
    "target_margin" DECIMAL(6,4) NOT NULL,
    "realised_margin" DECIMAL(6,4) NOT NULL,
    "constraint_binding" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_weight_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pack_weight_versions_tier_is_active_idx" ON "pack_weight_versions"("tier", "is_active");

-- AddForeignKey
ALTER TABLE "user_packs" ADD CONSTRAINT "user_packs_weight_version_id_fkey" FOREIGN KEY ("weight_version_id") REFERENCES "pack_weight_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
