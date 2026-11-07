-- Reunião de 2026-11-03: medicamento e vacina são cobrados e baixados por ML
-- ("por dose" dava margem a erro). O produto guarda quantos ml tem a unidade
-- de compra e, na vacina, o volume aplicado por animal.
--
-- doses_per_unit sai sem conversão: guardava DOSES, e não há como saber
-- quantos ml tem a dose de cada vacina. Reinterpretar 10 doses como 10 ml
-- daria preço e baixa errados sem ninguém perceber; vazio, o StockService
-- pede o dado na próxima edição. Ainda não há produção — só dados de
-- desenvolvimento e homologação, que o seed recria.
--
-- Escrita à mão, como as demais deste serviço (coluna GENERATED
-- sale_price_cents — ver schema.prisma). Os CHECKs não geram drift.
ALTER TABLE "products" DROP COLUMN "doses_per_unit";
ALTER TABLE "products" ADD COLUMN "ml_per_unit" DECIMAL(10,3);
ALTER TABLE "products" ADD COLUMN "application_ml" DECIMAL(10,3);

ALTER TABLE "products"
  ADD CONSTRAINT "products_ml_per_unit_positive"
  CHECK ("ml_per_unit" IS NULL OR "ml_per_unit" > 0),
  ADD CONSTRAINT "products_application_ml_positive"
  CHECK ("application_ml" IS NULL OR "application_ml" > 0);
