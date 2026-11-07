-- Reunião de 2026-11-03: vacina é registrada e cobrada por ML aplicado em
-- cada animal, não por dose ("por dose" dava margem a erro).
--
-- As colunas são renomeadas, não convertidas: não há como saber quantos ml
-- tinha a dose de cada vacina já registrada. Ainda não há produção — só dados
-- de desenvolvimento e homologação, que o seed recria. No registro externo o
-- volume vira opcional, e o valor antigo (uma contagem de doses) sai.
ALTER TABLE "vaccinations" RENAME COLUMN "doses_per_animal" TO "ml_per_animal";
ALTER TABLE "vaccinations" ALTER COLUMN "ml_per_animal" DROP DEFAULT;
ALTER TABLE "vaccinations" ALTER COLUMN "ml_per_animal" DROP NOT NULL;
UPDATE "vaccinations" SET "ml_per_animal" = NULL WHERE "origin" = 'external';

ALTER TABLE "vaccinations" RENAME COLUMN "price_per_dose_cents" TO "price_per_ml_cents";

ALTER TABLE "vaccinations"
  ADD CONSTRAINT vaccinations_clinic_has_ml
  CHECK (origin = 'external' OR ml_per_animal IS NOT NULL),
  ADD CONSTRAINT vaccinations_ml_per_animal_positive
  CHECK (ml_per_animal IS NULL OR ml_per_animal > 0);
