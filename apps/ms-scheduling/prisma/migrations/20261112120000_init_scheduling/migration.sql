-- ══════════════════════════════════════════════════════════════════
-- MS4 — Scheduling: agenda e última visita por propriedade (Sprint 9)
--
-- Escrita à mão a partir do `prisma migrate diff` (ver cabeçalho do
-- schema.prisma): os CHECKs, o índice único parcial do retorno e o RLS não
-- se expressam no Prisma.
-- ══════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ScheduleActivityType" AS ENUM ('appointment', 'visit', 'vaccination', 'exam', 'other');

-- CreateEnum
CREATE TYPE "ScheduleEventStatus" AS ENUM ('scheduled', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "VisitSourceType" AS ENUM ('appointment', 'vaccination', 'schedule_event');

-- CreateTable
CREATE TABLE "schedule_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "activity_type" "ScheduleActivityType" NOT NULL,
    "status" "ScheduleEventStatus" NOT NULL DEFAULT 'scheduled',
    "starts_at" TIMESTAMPTZ NOT NULL,
    "ends_at" TIMESTAMPTZ,
    "owner_id" UUID,
    "property_id" UUID,
    "animal_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "notes" TEXT,
    "reminder_minutes_before" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "source_appointment_id" UUID,
    "created_by" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "schedule_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_last_visits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "last_visit_at" TIMESTAMPTZ NOT NULL,
    "source_type" "VisitSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "property_last_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "table_name" VARCHAR(100) NOT NULL,
    "record_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_events_tenant_id_starts_at_idx" ON "schedule_events"("tenant_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "property_last_visits_tenant_id_property_id_key" ON "property_last_visits"("tenant_id", "property_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_table_name_record_id_idx" ON "audit_log"("tenant_id", "table_name", "record_id");


-- ─── Invariantes da agenda (o Prisma não modela CHECK) ───────────
-- Arrays escalares saem anuláveis no Prisma; o NOT NULL fica no CHECK, que o
-- Prisma não enxerga e por isso não tenta desfazer.
ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_arrays_not_null"
  CHECK (animal_ids IS NOT NULL AND reminder_minutes_before IS NOT NULL);

-- RF-AGD-002: proprietário e propriedade em todo evento, menos `other`.
ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_owner_property_required"
  CHECK (activity_type = 'other' OR (owner_id IS NOT NULL AND property_id IS NOT NULL));

ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_ends_after_starts"
  CHECK (ends_at IS NULL OR ends_at > starts_at);

-- RF-AGD-004: até 3 lembretes, de 0 a 7 dias (10080 min) antes.
ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_reminders_range"
  CHECK (
    cardinality(reminder_minutes_before) <= 3
    AND 0 <= ALL (reminder_minutes_before)
    AND 10080 >= ALL (reminder_minutes_before)
  );

-- Retorno (RF-ATD-010) é sempre uma visita.
ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_return_is_visit"
  CHECK (source_appointment_id IS NULL OR activity_type = 'visit');

-- Coerência entre status e datas de conclusão/cancelamento.
ALTER TABLE "schedule_events"
  ADD CONSTRAINT "schedule_events_status_dates"
  CHECK (
    (status = 'done') = (completed_at IS NOT NULL)
    AND (status = 'cancelled') = (cancelled_at IS NOT NULL)
  );

-- Um retorno ATIVO por atendimento. Cancelado ou excluído libera o
-- atendimento para um novo retorno.
CREATE UNIQUE INDEX "schedule_events_one_active_return"
  ON "schedule_events" ("tenant_id", "source_appointment_id")
  WHERE source_appointment_id IS NOT NULL AND deleted_at IS NULL AND status <> 'cancelled';

-- ─── Row-Level Security (ADR-001 §5.2) ───────────────────────────
-- Todo repository entra por withTenant(), que faz
-- set_config('app.current_tenant', ...) na transação. Vale só para roles
-- comuns: o runtime conecta como quironequine_app
-- (infra/postgres-init/01-create-app-role.sql). USING vale também como WITH
-- CHECK: gravar com o tenant de outro é recusado.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE schedule_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedule_events ON schedule_events
  USING (tenant_id = current_tenant_id());

ALTER TABLE property_last_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_property_last_visits ON property_last_visits
  USING (tenant_id = current_tenant_id());

-- audit_log: a role da aplicação só tem SELECT/INSERT (role script, seção 3d).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_log ON audit_log
  USING (tenant_id = current_tenant_id());
