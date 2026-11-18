-- ══════════════════════════════════════════════════════════════════
-- MS6 — Saídas de caixa (RF-REL-001/002), Sprint 11 do M3.
-- Gerada com `prisma migrate diff`; CHECKs e RLS escritos à mão no fim.
-- ══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('fuel', 'vehicle_maintenance', 'supplies_equipment', 'taxes_fees', 'stock_purchase', 'other');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "occurred_on" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" VARCHAR(255),
    "amount_cents" INTEGER NOT NULL,
    "product_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_tenant_id_occurred_on_idx" ON "expenses"("tenant_id", "occurred_on");


-- Valor sempre positivo, em centavos (ADR-001 §5.6). Teto de R$ 10 milhões
-- por lançamento: pega digitação errada (centavos a mais) sem limitar o uso.
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount_cents" > 0 AND "amount_cents" <= 1000000000),
  -- Produto só faz sentido na compra de estoque.
  ADD CONSTRAINT "expenses_product_only_on_stock_purchase" CHECK ("product_id" IS NULL OR "category" = 'stock_purchase');

-- RLS: mesmo padrão das demais tabelas do MS6 (USING vale também como WITH CHECK).
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_expenses ON expenses
  USING (tenant_id = current_tenant_id());
