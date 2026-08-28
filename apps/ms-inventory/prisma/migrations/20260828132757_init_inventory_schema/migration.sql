-- CreateEnum
CREATE TYPE "ProductUnit" AS ENUM ('ampola', 'bolsa', 'caixa', 'frasco', 'galao', 'grama', 'kg', 'litros', 'ml', 'pacote', 'peca', 'unidade');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('medication', 'vaccine', 'supply');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('purchase', 'appointment', 'exam', 'vaccination', 'manual', 'expired');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('expiry', 'low_stock');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "manufacturer" VARCHAR(255),
    "batch" VARCHAR(100),
    "unit" "ProductUnit" NOT NULL,
    "quantity_in_stock" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "doses_per_unit" DECIMAL(10,3),
    "cost_price_cents" INTEGER NOT NULL,
    "markup_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "expiry_date" DATE,
    "alert_days_before" INTEGER NOT NULL DEFAULT 30,
    "min_stock_qty" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "category" "ProductCategory" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "reason" "MovementReason" NOT NULL,
    "reference_id" UUID,
    "reference_type" VARCHAR(50),
    "idempotency_key" UUID NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID,
    "alert_type" "AlertType" NOT NULL,
    "threshold_days" INTEGER,
    "threshold_qty" DECIMAL(10,3),
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "last_triggered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_expiry_date_idx" ON "products"("expiry_date");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_idx" ON "stock_movements"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- CreateIndex
CREATE INDEX "stock_movements_type_idx" ON "stock_movements"("type");

-- CreateIndex
CREATE INDEX "stock_movements_reason_idx" ON "stock_movements"("reason");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE INDEX "alert_configs_tenant_id_idx" ON "alert_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "alert_configs_alert_type_idx" ON "alert_configs"("alert_type");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_configs" ADD CONSTRAINT "alert_configs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
