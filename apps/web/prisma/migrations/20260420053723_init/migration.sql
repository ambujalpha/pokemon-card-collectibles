-- CreateEnum
CREATE TYPE "ledger_reason_enum" AS ENUM ('FUND_DEPOSIT', 'PACK_PURCHASE', 'TRADE_BUY', 'TRADE_SELL', 'TRADE_FEE', 'BID_HOLD', 'BID_RELEASE', 'AUCTION_WIN', 'AUCTION_SELL', 'AUCTION_FEE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_held" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delta" DECIMAL(18,4) NOT NULL,
    "reason" "ledger_reason_enum" NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID,
    "balance_after" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "ledger_user_id_created_at_idx" ON "ledger"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_reason_created_at_idx" ON "ledger"("reason", "created_at");

-- AddForeignKey
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
