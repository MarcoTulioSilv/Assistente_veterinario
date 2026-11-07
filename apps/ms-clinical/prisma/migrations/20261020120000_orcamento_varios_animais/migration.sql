-- ══════════════════════════════════════════════════════════════════
-- MS3 — Atendimento vira orçamento de visita (reunião com os stakeholders,
-- 20/10/2026)
--
--  - vários animais por orçamento, com ficha e receita POR ANIMAL;
--  - procedimento sai dos itens: vira texto, e o valor entra na mão de obra;
--  - nome do orçamento e ponto do atendimento no mapa.
--
-- Escrita à mão: o diff do Prisma apagaria animal_id antes de copiá-lo e
-- criaria colunas NOT NULL sem valor. Esta versão preserva os dados — e
-- nenhum total muda, nem de orçamento já finalizado (o valor dos itens de
-- procedimento é somado à mão de obra, que entra no total do mesmo jeito).
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. Animais do orçamento ────────────────────────────────────
CREATE TABLE "appointment_animals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,

    CONSTRAINT "appointment_animals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_animals_tenant_id_idx" ON "appointment_animals"("tenant_id");
CREATE INDEX "appointment_animals_animal_id_idx" ON "appointment_animals"("animal_id");
CREATE UNIQUE INDEX "appointment_animals_appointment_id_animal_id_key" ON "appointment_animals"("appointment_id", "animal_id");

ALTER TABLE "appointment_animals" ADD CONSTRAINT "appointment_animals_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O animal único de cada atendimento existente vira o primeiro da lista.
INSERT INTO "appointment_animals" ("id", "tenant_id", "appointment_id", "animal_id")
SELECT gen_random_uuid(), "tenant_id", "id", "animal_id" FROM "appointments";

ALTER TABLE appointment_animals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_appointment_animals ON appointment_animals
  USING (tenant_id = current_tenant_id());

-- ─── 2. Ficha e receita passam a ser de (orçamento, animal) ─────
ALTER TABLE "medical_records" ADD COLUMN "animal_id" UUID;
UPDATE "medical_records" mr SET "animal_id" = a."animal_id" FROM "appointments" a WHERE a."id" = mr."appointment_id";
ALTER TABLE "medical_records" ALTER COLUMN "animal_id" SET NOT NULL;

ALTER TABLE "medical_records" DROP CONSTRAINT "medical_records_appointment_id_fkey";
DROP INDEX "medical_records_appointment_id_key";
CREATE UNIQUE INDEX "medical_records_appointment_id_animal_id_key" ON "medical_records"("appointment_id", "animal_id");
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_animal_id_fkey"
  FOREIGN KEY ("appointment_id", "animal_id") REFERENCES "appointment_animals"("appointment_id", "animal_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prescriptions" ADD COLUMN "animal_id" UUID;
UPDATE "prescriptions" p SET "animal_id" = a."animal_id" FROM "appointments" a WHERE a."id" = p."appointment_id";
ALTER TABLE "prescriptions" ALTER COLUMN "animal_id" SET NOT NULL;

ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_appointment_id_fkey";
DROP INDEX "prescriptions_appointment_id_idx";
CREATE INDEX "prescriptions_appointment_id_animal_id_idx" ON "prescriptions"("appointment_id", "animal_id");
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_animal_id_fkey"
  FOREIGN KEY ("appointment_id", "animal_id") REFERENCES "appointment_animals"("appointment_id", "animal_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. Nome, ponto no mapa e descrição do procedimento ─────────
ALTER TABLE "appointments"
  ADD COLUMN "title" VARCHAR(255),
  ADD COLUMN "location_latitude" DECIMAL(9,6),
  ADD COLUMN "location_longitude" DECIMAL(9,6),
  ADD COLUMN "procedure_description" TEXT;

-- Mesma regra do service quando a tela não manda nome: data (São Paulo) +
-- especialidade.
UPDATE "appointments" SET "title" =
  to_char("performed_at" AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ' - ' ||
  CASE "type"
    WHEN 'clinico_geral' THEN 'Clínico geral'
    WHEN 'reproducao'    THEN 'Reprodução'
    WHEN 'odontologico'  THEN 'Odontológico'
    WHEN 'locomotor'     THEN 'Locomotor'
    WHEN 'cirurgia'      THEN 'Cirurgia'
  END;
ALTER TABLE "appointments" ALTER COLUMN "title" SET NOT NULL;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_both_or_none"
  CHECK (("location_latitude" IS NULL) = ("location_longitude" IS NULL));

-- ─── 4. Procedimento sai dos itens ──────────────────────────────
-- Descrição vira texto do orçamento; valor soma na mão de obra. O total
-- (itens + mão de obra + km) fica igual.
UPDATE "appointments" a SET
  "procedure_description" = p.descriptions,
  "labor_cents" = a."labor_cents" + p.total
FROM (
  SELECT "appointment_id",
         string_agg("description" || CASE WHEN "quantity" <> 1 THEN ' (x' || trim_scale("quantity")::text || ')' ELSE '' END,
                    '; ' ORDER BY "created_at") AS descriptions,
         sum("total_cents")::int AS total
  FROM "appointment_items"
  WHERE "kind" = 'procedure'
  GROUP BY "appointment_id"
) p
WHERE a."id" = p."appointment_id";

DELETE FROM "appointment_items" WHERE "kind" = 'procedure';

ALTER TABLE "appointment_items" DROP COLUMN "kind", ALTER COLUMN "product_id" SET NOT NULL;
DROP TYPE "AppointmentItemKind";

-- ─── 5. O animal único sai do orçamento ─────────────────────────
DROP INDEX "appointments_animal_id_idx";
ALTER TABLE "appointments" DROP COLUMN "animal_id";
