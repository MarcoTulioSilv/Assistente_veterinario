-- ══════════════════════════════════════════════════════════════════
-- MS3 — Exames (RF-EXM-001 a 006, Sprint 6)
--
-- Tabelas geradas por `prisma migrate diff` entre o schema anterior e o
-- atual (sem banco: o Docker estava fora durante o desenvolvimento).
-- RLS e a função de leitura do lembrete escritas à mão, abaixo.
-- ══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'requested', 'collected', 'in_analysis', 'result_available');

-- CreateTable
CREATE TABLE "exam_types" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "default_price_cents" INTEGER NOT NULL DEFAULT 0,
    "expected_turnaround_days" INTEGER,
    "protocol_fields" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "veterinarian_id" UUID NOT NULL,
    "exam_type_id" UUID NOT NULL,
    "exam_type_name" VARCHAR(255) NOT NULL,
    "protocol_fields" JSONB NOT NULL DEFAULT '[]',
    "protocol_data" JSONB NOT NULL DEFAULT '{}',
    "material" VARCHAR(255),
    "collected_at" TIMESTAMPTZ,
    "lot_description" VARCHAR(255),
    "lot_size" INTEGER,
    "status" "ExamStatus" NOT NULL DEFAULT 'draft',
    "expected_result_at" TIMESTAMPTZ,
    "result_file_url" TEXT,
    "result_uploaded_at" TIMESTAMPTZ,
    "paid_directly_by_client" BOOLEAN NOT NULL DEFAULT false,
    "unit_price_cents" INTEGER NOT NULL DEFAULT 0,
    "labor_cents" INTEGER NOT NULL DEFAULT 0,
    "displacement_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "displacement_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "charged_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "exam_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_request_animals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_request_id" UUID NOT NULL,
    "animal_id" UUID NOT NULL,

    CONSTRAINT "exam_request_animals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_request_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exam_request_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,

    CONSTRAINT "exam_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_types_tenant_id_idx" ON "exam_types"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_requests_tenant_id_idx" ON "exam_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_requests_owner_id_idx" ON "exam_requests"("owner_id");

-- CreateIndex
CREATE INDEX "exam_requests_status_idx" ON "exam_requests"("status");

-- CreateIndex
CREATE INDEX "exam_requests_expected_result_at_idx" ON "exam_requests"("expected_result_at");

-- CreateIndex
CREATE INDEX "exam_request_animals_tenant_id_idx" ON "exam_request_animals"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_request_animals_animal_id_idx" ON "exam_request_animals"("animal_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_request_animals_exam_request_id_animal_id_key" ON "exam_request_animals"("exam_request_id", "animal_id");

-- CreateIndex
CREATE INDEX "exam_request_items_tenant_id_idx" ON "exam_request_items"("tenant_id");

-- CreateIndex
CREATE INDEX "exam_request_items_exam_request_id_idx" ON "exam_request_items"("exam_request_id");

-- AddForeignKey
ALTER TABLE "exam_requests" ADD CONSTRAINT "exam_requests_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "exam_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_request_animals" ADD CONSTRAINT "exam_request_animals_exam_request_id_fkey" FOREIGN KEY ("exam_request_id") REFERENCES "exam_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_request_items" ADD CONSTRAINT "exam_request_items_exam_request_id_fkey" FOREIGN KEY ("exam_request_id") REFERENCES "exam_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS — o isolamento entre tenants é do banco (ADR-001 §5.2) ──
ALTER TABLE exam_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_exam_types ON exam_types
  USING (tenant_id = current_tenant_id());

ALTER TABLE exam_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_exam_requests ON exam_requests
  USING (tenant_id = current_tenant_id());

ALTER TABLE exam_request_animals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_exam_request_animals ON exam_request_animals
  USING (tenant_id = current_tenant_id());

ALTER TABLE exam_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_exam_request_items ON exam_request_items
  USING (tenant_id = current_tenant_id());

-- ─── Leitura cross-tenant do lembrete (padrão da ADR-006) ────────
-- O lembrete D-1/no dia é um job diário que varre TODOS os tenants — não
-- roda no contexto de nenhum. Em vez de um client Prisma de superusuário
-- vivo no processo, uma função SECURITY DEFINER estreita: só leitura, só
-- as colunas que o lembrete usa, só pedidos que ainda esperam resultado.
-- Se a dona da função perder bypassrls, ela volta a respeitar RLS e
-- devolve zero linhas — falha fechada.
--
-- Recebe uma JANELA, não "hoje"/"amanhã": o que conta como dia é o fuso
-- de America/Sao_Paulo, e essa conta mora no service (testável), não aqui.
CREATE OR REPLACE FUNCTION clinical_list_exams_result_due(from_ts TIMESTAMPTZ, to_ts TIMESTAMPTZ)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  owner_id UUID,
  veterinarian_id UUID,
  exam_type_name VARCHAR(255),
  expected_result_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, owner_id, veterinarian_id, exam_type_name, expected_result_at
  FROM exam_requests
  WHERE status IN ('collected', 'in_analysis')
    AND deleted_at IS NULL
    AND expected_result_at >= from_ts
    AND expected_result_at < to_ts;
$$;

REVOKE ALL ON FUNCTION clinical_list_exams_result_due(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
-- GRANT EXECUTE pra quironequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (mesmo padrão do ADR-004/006).
