-- CreateEnum
CREATE TYPE "rarity_enum" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "pack_tier_enum" AS ENUM ('STARTER', 'PREMIUM', 'ULTRA');

-- CreateEnum
CREATE TYPE "drop_status_enum" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'SOLD_OUT');

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "pokemontcg_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "set_code" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rarity_bucket" "rarity_enum" NOT NULL,
    "image_url" TEXT NOT NULL,
    "base_price" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drops" (
    "id" UUID NOT NULL,
    "pack_tier" "pack_tier_enum" NOT NULL,
    "total_inventory" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ NOT NULL,
    "status" "drop_status_enum" NOT NULL DEFAULT 'SCHEDULED',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_packs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "drop_id" UUID NOT NULL,
    "purchased_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_revealed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_cards" (
    "id" UUID NOT NULL,
    "user_pack_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "priced_captured" DECIMAL(18,4) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "pack_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cards_pokemontcg_id_key" ON "cards"("pokemontcg_id");

-- CreateIndex
CREATE INDEX "cards_rarity_bucket_idx" ON "cards"("rarity_bucket");

-- CreateIndex
CREATE INDEX "drops_status_starts_at_idx" ON "drops"("status", "starts_at");

-- CreateIndex
CREATE INDEX "user_packs_user_id_is_revealed_idx" ON "user_packs"("user_id", "is_revealed");

-- CreateIndex
CREATE INDEX "user_packs_user_id_drop_id_idx" ON "user_packs"("user_id", "drop_id");

-- CreateIndex
CREATE INDEX "pack_cards_user_pack_id_idx" ON "pack_cards"("user_pack_id");

-- AddForeignKey
ALTER TABLE "drops" ADD CONSTRAINT "drops_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_packs" ADD CONSTRAINT "user_packs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_packs" ADD CONSTRAINT "user_packs_drop_id_fkey" FOREIGN KEY ("drop_id") REFERENCES "drops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_cards" ADD CONSTRAINT "pack_cards_user_pack_id_fkey" FOREIGN KEY ("user_pack_id") REFERENCES "user_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_cards" ADD CONSTRAINT "pack_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
