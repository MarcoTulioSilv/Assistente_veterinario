-- ══════════════════════════════════════════════════════════════════
-- MS3 — Ajuste de performance (Sprint 8, homologação M2)
--
-- Medido com scripts/perf-explain.ts (500 mil linhas por tabela, 10
-- tenants, RLS ativo). Números em Documentação/MS3-revisao-performance-seguranca.md.
--
-- Sem CONCURRENTLY: o Prisma roda a migration numa transação, onde ele não
-- é permitido. As tabelas ainda são pequenas (pré-produção), então o lock
-- de escrita do CREATE INDEX dura pouco. Em base grande, criar os índices
-- à mão com CONCURRENTLY antes de aplicar esta migration.
-- ══════════════════════════════════════════════════════════════════

-- ─── Listas paginadas: índice na ordem da tela ──────────────────
-- As listas ordenavam TODAS as linhas do tenant pra devolver 20 (top-N
-- heapsort): 30 ms com 50 mil exames numa clínica, crescendo com o
-- volume. Com (tenant_id, <ordem>) o Postgres lê só a página.
-- Os índices novos cobrem o tenant_id sozinho, então os antigos saem —
-- manter os dois só encareceria as escritas. Criados antes de apagar os
-- antigos pra não haver instante sem índice.

-- CreateIndex
CREATE INDEX "appointments_tenant_id_performed_at_idx" ON "appointments"("tenant_id", "performed_at" DESC);

-- CreateIndex
CREATE INDEX "exam_requests_tenant_id_created_at_idx" ON "exam_requests"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "vaccinations_tenant_id_applied_at_created_at_idx" ON "vaccinations"("tenant_id", "applied_at" DESC, "created_at" DESC);

-- DropIndex
DROP INDEX "appointments_tenant_id_idx";

-- DropIndex (performed_at sem tenant: nenhuma consulta ordena por ele fora do tenant)
DROP INDEX "appointments_performed_at_idx";

-- DropIndex
DROP INDEX "exam_requests_tenant_id_idx";

-- DropIndex
DROP INDEX "vaccinations_tenant_id_idx";

-- ─── Lembrete de re-vacinação: busca por animal ─────────────────
-- O NOT EXISTS virava um hash anti-join contra TODAS as vacinações de
-- TODOS os tenants: montava uma tabela hash da base inteira a cada
-- execução e transbordava pra disco (~115 MB de temp com 500 mil
-- vacinações), com custo crescendo com o tamanho total da tabela.
--
-- O LATERAL ... LIMIT 1 força a busca da re-vacinação animal a animal,
-- pelo índice vaccination_animals(animal_id): o custo passa a acompanhar
-- só os candidatos da janela, sem disco temporário. Junto, o service pede
-- duas janelas estreitas (em volta de hoje e de hoje + 7) em vez de 11
-- dias corridos. Mesma assinatura e mesmo resultado da versão anterior.
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
  LEFT JOIN LATERAL (
    SELECT 1 AS found
    FROM vaccination_animals nva
    JOIN vaccinations newer ON newer.id = nva.vaccination_id
    WHERE nva.animal_id = va.animal_id
      AND newer.tenant_id = v.tenant_id
      AND newer.deleted_at IS NULL
      AND clinical_same_vaccine(newer.product_id, newer.vaccine_name, v.product_id, v.vaccine_name)
      AND (newer.applied_at, newer.created_at) > (v.applied_at, v.created_at)
    LIMIT 1
  ) revaccinated ON true
  WHERE v.deleted_at IS NULL
    AND v.next_dose_at >= from_ts
    AND v.next_dose_at < to_ts
    AND revaccinated.found IS NULL;
$$;

-- CREATE OR REPLACE mantém dono e permissões (o GRANT do bloco 4e do
-- 01-create-app-role.sql continua valendo); o REVOKE é reafirmado por
-- garantia.
REVOKE ALL ON FUNCTION clinical_list_vaccinations_due(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
