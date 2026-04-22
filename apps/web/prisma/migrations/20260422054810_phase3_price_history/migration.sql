-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "last_priced_at" TIMESTAMPTZ,
ADD COLUMN     "stale_since" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "refreshed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_snapshots_card_id_refreshed_at_idx" ON "price_snapshots"("card_id", "refreshed_at" DESC);

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
