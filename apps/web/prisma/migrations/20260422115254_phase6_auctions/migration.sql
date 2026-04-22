-- CreateEnum
CREATE TYPE "auction_status_enum" AS ENUM ('LIVE', 'CLOSED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "user_card_status_enum" ADD VALUE 'AUCTION';

-- CreateTable
CREATE TABLE "auctions" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "user_card_id" UUID NOT NULL,
    "starting_bid" DECIMAL(18,4) NOT NULL,
    "current_bid" DECIMAL(18,4),
    "current_bidder_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closes_at" TIMESTAMPTZ NOT NULL,
    "extensions" INTEGER NOT NULL DEFAULT 0,
    "status" "auction_status_enum" NOT NULL DEFAULT 'LIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "winner_id" UUID,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auctions_user_card_id_key" ON "auctions"("user_card_id");

-- CreateIndex
CREATE INDEX "auctions_status_closes_at_idx" ON "auctions"("status", "closes_at");

-- CreateIndex
CREATE INDEX "auctions_seller_id_status_idx" ON "auctions"("seller_id", "status");

-- CreateIndex
CREATE INDEX "bids_auction_id_created_at_idx" ON "bids"("auction_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bids_bidder_id_created_at_idx" ON "bids"("bidder_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_user_card_id_fkey" FOREIGN KEY ("user_card_id") REFERENCES "user_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
