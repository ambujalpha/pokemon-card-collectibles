-- CreateEnum
CREATE TYPE "user_card_status_enum" AS ENUM ('HELD', 'LISTED', 'SOLD');

-- CreateEnum
CREATE TYPE "listing_status_enum" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED');

-- CreateTable
CREATE TABLE "user_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pack_card_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquired_price" DECIMAL(18,4) NOT NULL,
    "status" "user_card_status_enum" NOT NULL DEFAULT 'HELD',

    CONSTRAINT "user_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_card_id" UUID NOT NULL,
    "price_ask" DECIMAL(18,4) NOT NULL,
    "status" "listing_status_enum" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sold_at" TIMESTAMPTZ,
    "buyer_id" UUID,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_cards_pack_card_id_key" ON "user_cards"("pack_card_id");

-- CreateIndex
CREATE INDEX "user_cards_user_id_status_idx" ON "user_cards"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_cards_card_id_idx" ON "user_cards"("card_id");

-- CreateIndex
CREATE INDEX "listings_status_created_at_idx" ON "listings"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "listings_seller_id_status_idx" ON "listings"("seller_id", "status");

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_pack_card_id_fkey" FOREIGN KEY ("pack_card_id") REFERENCES "pack_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "user_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Backfill user_cards from existing revealed packs ──────────────────────
-- For each revealed user_pack, allocate the pack tier price across its
-- pack_cards by ratio of priced_captured. Rounded to 4 decimals; any sub-cent
-- residual is acceptable for dev-only backfill (prod has no data yet).
INSERT INTO user_cards (id, user_id, pack_card_id, card_id, acquired_at, acquired_price, status)
SELECT
  gen_random_uuid(),
  up.user_id,
  pc.id,
  pc.card_id,
  up.purchased_at,
  ROUND(
    (pc.priced_captured / NULLIF(SUM(pc.priced_captured) OVER (PARTITION BY pc.user_pack_id), 0))
    * CASE d.pack_tier
        WHEN 'STARTER' THEN 5
        WHEN 'PREMIUM' THEN 20
        WHEN 'ULTRA'   THEN 50
      END,
    4
  ),
  'HELD'
FROM pack_cards pc
JOIN user_packs up ON up.id = pc.user_pack_id
JOIN drops      d  ON d.id  = up.drop_id
WHERE up.is_revealed = true;
