-- ══════════════════════════════════════════════════════════════════
-- MS4 — Geofence (Sprint 11 do M3; RF-AGD-005, RF-NOT-004, RN-008, RF-CFG-005)
--
-- geofence_settings: raio e "dias sem visita" de cada clínica. Sem linha,
--   vale o padrão do sistema (GEOFENCE_DEFAULTS: 500 m e 90 dias).
-- geofence_hits: um aviso por propriedade por dia (São Paulo). Guarda só o
--   id da propriedade, o dia, quem recebeu e o motivo: a posição do aparelho
--   nunca chega ao servidor.
--
-- Escrita à mão a partir do `prisma migrate diff`, como as demais deste
-- serviço: CHECKs e RLS não se expressam no Prisma.
-- ══════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "geofence_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "radius_meters" INTEGER NOT NULL,
    "no_visit_days" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "geofence_settings_pkey" PRIMARY KEY ("id"),
    -- Mesmos limites de GEOFENCE_LIMITS (shared-types).
    CONSTRAINT "geofence_settings_radius_range" CHECK ("radius_meters" BETWEEN 50 AND 5000),
    CONSTRAINT "geofence_settings_no_visit_days_range" CHECK ("no_visit_days" BETWEEN 1 AND 3650)
);

-- CreateTable
CREATE TABLE "geofence_hits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "reasons" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_hits_pkey" PRIMARY KEY ("id"),
    -- Array escalar sai anulável no Prisma; o NOT NULL fica no CHECK (mesmo
    -- padrão de schedule_events). Só avisa com pelo menos um motivo.
    CONSTRAINT "geofence_hits_reasons_valid" CHECK (
      "reasons" IS NOT NULL
      AND cardinality("reasons") >= 1
      AND "reasons" <@ ARRAY['return_pending', 'no_recent_visit']::TEXT[]
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "geofence_settings_tenant_id_key" ON "geofence_settings"("tenant_id");

-- CreateIndex: é esta UNIQUE que garante "um aviso por propriedade por dia".
CREATE UNIQUE INDEX "geofence_hits_tenant_id_property_id_day_key" ON "geofence_hits"("tenant_id", "property_id", "day");

-- ─── Row-Level Security (ADR-001 §5.2) ───────────────────────────
ALTER TABLE geofence_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_geofence_settings ON geofence_settings
  USING (tenant_id = current_tenant_id());

ALTER TABLE geofence_hits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_geofence_hits ON geofence_hits
  USING (tenant_id = current_tenant_id());
