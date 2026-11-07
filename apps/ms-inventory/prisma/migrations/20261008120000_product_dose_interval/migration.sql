-- RF-VAC-005: intervalo entre doses de uma vacina, base do alerta de
-- re-vacinação (Sprint 7). Nulo = sem re-vacinação.
--
-- Escrita à mão, como as demais deste serviço: `products` tem a coluna
-- GENERATED sale_price_cents, que o diff do Prisma não entende (ver
-- comentário no schema.prisma).
--
-- O CHECK não aparece no schema.prisma (Prisma não modela CHECK) e não gera
-- drift: o diff do Prisma ignora constraints desse tipo.
ALTER TABLE "products" ADD COLUMN "dose_interval_days" INTEGER;

ALTER TABLE "products"
  ADD CONSTRAINT "products_dose_interval_days_positive"
  CHECK ("dose_interval_days" IS NULL OR "dose_interval_days" > 0);
