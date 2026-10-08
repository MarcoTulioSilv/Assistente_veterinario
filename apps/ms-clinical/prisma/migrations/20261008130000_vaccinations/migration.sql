-- ══════════════════════════════════════════════════════════════════
-- MS3 — Vacinação (RF-VAC-001 a 005, Sprint 7)
--
-- Tabelas geradas por `prisma migrate diff` entre o schema anterior e o
-- atual. RLS e a função de leitura do lembrete escritas à mão, abaixo.
-- ══════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "veterinarian_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "vaccine_name" VARCHAR(255) NOT NULL,
    "vaccine_batch" VARCHAR(100),
    "doses_per_animal" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "applied_at" TIMESTAMPTZ NOT NULL,
    "dose_interval_days" INTEGER,
    "next_dose_at" TIMESTAMPTZ,
    "price_per_dose_cents" INTEGER NOT NULL,
    "labor_cents" INTEGER NOT NULL DEFAULT 0,
    "displacement_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "displacement_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccination_animals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "vaccination_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,

    CONSTRAINT "vaccination_animals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vaccinations_tenant_id_idx" ON "vaccinations"("tenant_id");

-- CreateIndex
CREATE INDEX "vaccinations_owner_id_idx" ON "vaccinations"("owner_id");

-- CreateIndex
CREATE INDEX "vaccinations_product_id_idx" ON "vaccinations"("product_id");

-- CreateIndex
CREATE INDEX "vaccinations_next_dose_at_idx" ON "vaccinations"("next_dose_at");

-- CreateIndex
CREATE INDEX "vaccination_animals_tenant_id_idx" ON "vaccination_animals"("tenant_id");

-- CreateIndex
CREATE INDEX "vaccination_animals_animal_id_idx" ON "vaccination_animals"("animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "vaccination_animals_vaccination_id_animal_id_key" ON "vaccination_animals"("vaccination_id", "animal_id");

-- AddForeignKey
ALTER TABLE "vaccination_animals" ADD CONSTRAINT "vaccination_animals_vaccination_id_fkey" FOREIGN KEY ("vaccination_id") REFERENCES "vaccinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS — o isolamento entre tenants é do banco (ADR-001 §5.2) ──
ALTER TABLE vaccinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vaccinations ON vaccinations
  USING (tenant_id = current_tenant_id());

ALTER TABLE vaccination_animals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vaccination_animals ON vaccination_animals
  USING (tenant_id = current_tenant_id());

-- ─── Leitura cross-tenant do lembrete de re-vacinação (ADR-006) ──
-- Mesmo padrão de clinical_list_exams_result_due: job diário que varre
-- todos os tenants, por função SECURITY DEFINER estreita (só leitura, só
-- as colunas do lembrete). A janela vem do service, que decide o que é
-- "dia" no fuso de America/Sao_Paulo.
--
-- Uma linha por (aplicação, animal), e só para o animal que NÃO foi
-- re-vacinado com a mesma vacina depois daquela aplicação: re-vacinar
-- substitui o lembrete anterior. Sem esse filtro, o cavalo vacinado de novo
-- na semana passada receberia o aviso da dose antiga.
CREATE OR REPLACE FUNCTION clinical_list_vaccinations_due(from_ts TIMESTAMPTZ, to_ts TIMESTAMPTZ)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  owner_id UUID,
  property_id UUID,
  veterinarian_id UUID,
  vaccine_name VARCHAR(255),
  next_dose_at TIMESTAMPTZ,
  animal_id UUID
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.tenant_id, v.owner_id, v.property_id, v.veterinarian_id,
         v.vaccine_name, v.next_dose_at, va.animal_id
  FROM vaccinations v
  JOIN vaccination_animals va ON va.vaccination_id = v.id
  WHERE v.deleted_at IS NULL
    AND v.next_dose_at >= from_ts
    AND v.next_dose_at < to_ts
    AND NOT EXISTS (
      SELECT 1
      FROM vaccinations newer
      JOIN vaccination_animals nva ON nva.vaccination_id = newer.id
      WHERE newer.tenant_id = v.tenant_id
        AND newer.product_id = v.product_id
        AND nva.animal_id = va.animal_id
        AND newer.deleted_at IS NULL
        AND (newer.applied_at, newer.created_at) > (v.applied_at, v.created_at)
    );
$$;

REVOKE ALL ON FUNCTION clinical_list_vaccinations_due(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
-- GRANT EXECUTE pra quironequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (mesmo padrão do ADR-004/006).
