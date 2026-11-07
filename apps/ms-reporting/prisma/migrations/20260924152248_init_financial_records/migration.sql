-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'received');

-- CreateEnum
CREATE TYPE "FinancialSourceType" AS ENUM ('appointment', 'exam', 'vaccination');

-- CreateTable
CREATE TABLE "financial_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "source_type" "FinancialSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "idempotency_key" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "financial_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_records_idempotency_key_key" ON "financial_records"("idempotency_key");

-- CreateIndex
CREATE INDEX "financial_records_tenant_id_idx" ON "financial_records"("tenant_id");

-- CreateIndex
CREATE INDEX "financial_records_owner_id_idx" ON "financial_records"("owner_id");

-- CreateIndex
CREATE INDEX "financial_records_status_idx" ON "financial_records"("status");

-- CreateIndex
CREATE INDEX "financial_records_occurred_at_idx" ON "financial_records"("occurred_at");

-- CreateIndex
CREATE INDEX "financial_records_source_type_source_id_idx" ON "financial_records"("source_type", "source_id");
