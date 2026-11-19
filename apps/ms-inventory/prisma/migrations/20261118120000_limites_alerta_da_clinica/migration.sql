-- RF-CFG-004 (Sprint 11 do M3): limites de alerta de estoque "globalmente e
-- por produto". O produto passa a poder não ter limite próprio (NULL) e usar
-- o padrão da clínica, guardado em inventory_settings.
--
-- O comportamento não muda: os valores que eram o padrão antigo da coluna
-- (30 dias de aviso de validade, estoque mínimo 0) viram NULL, e sem linha
-- em inventory_settings vale o padrão do sistema — 30 dias e nenhum mínimo
-- (mínimo 0 nunca disparava: estoque não fica abaixo de zero). Ainda não há
-- produção; mudar o significado da coluna é aceito antes do go-live.
--
-- Escrita à mão, como as demais deste serviço (coluna GENERATED
-- sale_price_cents — ver schema.prisma).
ALTER TABLE "products" ALTER COLUMN "alert_days_before" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "alert_days_before" DROP NOT NULL;
ALTER TABLE "products" ALTER COLUMN "min_stock_qty" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "min_stock_qty" DROP NOT NULL;

UPDATE "products" SET "alert_days_before" = NULL WHERE "alert_days_before" = 30;
UPDATE "products" SET "min_stock_qty" = NULL WHERE "min_stock_qty" = 0;

ALTER TABLE "products"
  ADD CONSTRAINT "products_alert_days_before_range"
  CHECK ("alert_days_before" IS NULL OR "alert_days_before" BETWEEN 0 AND 3650),
  ADD CONSTRAINT "products_min_stock_qty_non_negative"
  CHECK ("min_stock_qty" IS NULL OR "min_stock_qty" >= 0);

-- CreateTable
CREATE TABLE "inventory_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "default_alert_days_before" INTEGER,
    "default_min_stock_qty" DECIMAL(10,3),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_settings_alert_days_range"
      CHECK ("default_alert_days_before" IS NULL OR "default_alert_days_before" BETWEEN 0 AND 3650),
    CONSTRAINT "inventory_settings_min_stock_non_negative"
      CHECK ("default_min_stock_qty" IS NULL OR "default_min_stock_qty" >= 0)
);

CREATE UNIQUE INDEX "inventory_settings_tenant_id_key" ON "inventory_settings"("tenant_id");

-- RLS: mesmo padrão das demais tabelas do MS2.
ALTER TABLE inventory_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inventory_settings ON inventory_settings
  USING (tenant_id = current_tenant_id());
