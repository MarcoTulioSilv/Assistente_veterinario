-- ════════════════════════════════════════════════════════════════
-- FKs compostas por tenant no MS2 (auditoria 06/11/2026, item 3)
--
-- O Postgres confere chave estrangeira SEM passar pelo RLS: com FK só em
-- (product_id) → products(id), basta o UUID existir em QUALQUER clínica
-- para a FK aceitar. Com (tenant_id, product_id) → products(tenant_id, id),
-- o próprio banco garante que o produto é da mesma clínica. Mesmo padrão do
-- MS1 e do MS3.
--
-- alert_configs.product_id é opcional: com product_id nulo (alerta da
-- clínica inteira), a FK não se aplica (MATCH SIMPLE), como antes.
--
-- Escrita à mão a partir do `prisma migrate diff`: sai a linha
-- `ALTER COLUMN "sale_price_cents" DROP DEFAULT`, drift conhecido da coluna
-- GENERATED que o Prisma não representa.
-- ════════════════════════════════════════════════════════════════

-- Pré-checagem: aborta com mensagem clara se já houver ligação entre clínicas.
DO $$
DECLARE n INT;
BEGIN
  SELECT
    (SELECT count(*) FROM stock_movements x JOIN products p ON p.id = x.product_id WHERE p.tenant_id <> x.tenant_id)
  + (SELECT count(*) FROM alert_configs x JOIN products p ON p.id = x.product_id WHERE p.tenant_id <> x.tenant_id)
  INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Auditoria item 3: % ligação(ões) entre clínicas diferentes no MS2; corrija os dados antes de aplicar esta migração', n;
  END IF;
END
$$;

-- DropForeignKey
ALTER TABLE "alert_configs" DROP CONSTRAINT "alert_configs_product_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_product_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_configs" ADD CONSTRAINT "alert_configs_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
