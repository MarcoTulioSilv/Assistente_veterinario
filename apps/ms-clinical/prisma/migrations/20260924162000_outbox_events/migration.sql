-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_name" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_idx" ON "outbox_events"("tenant_id");

-- ══════════════════════════════════════════════════════════════════
-- RLS + leitura cross-tenant do relay (ADR-002, padrão do ADR-006)
--
-- A tabela tem tenant_id, então tem policy como todas as outras: quem
-- GRAVA no outbox é um service dentro de withTenant(), e só enxerga o
-- próprio tenant.
--
-- Mas quem LÊ é o relay, que é um processo de infraestrutura e precisa
-- drenar os eventos pendentes de TODOS os tenants -- mesmo problema que
-- o AlertService tinha na ADR-006. Mesma solução: função SECURITY
-- DEFINER estreita, só leitura, devolvendo exatamente as colunas que o
-- relay usa. Nada de client Prisma de superusuário vivo no processo.
--
-- A MARCAÇÃO como publicado não precisa de bypass: o relay já recebe o
-- tenant_id de cada linha e faz o UPDATE dentro de withTenant(), pelo
-- caminho normal com RLS ativo.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_outbox_events ON outbox_events
  USING (tenant_id = current_tenant_id());

CREATE OR REPLACE FUNCTION clinical_list_pending_outbox(max_rows INTEGER)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  event_name VARCHAR(100),
  payload JSONB,
  idempotency_key UUID,
  attempts INTEGER
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id, tenant_id, event_name, payload, idempotency_key, attempts
  FROM outbox_events
  WHERE published_at IS NULL
  ORDER BY created_at
  LIMIT max_rows;
$$;

REVOKE ALL ON FUNCTION clinical_list_pending_outbox(INTEGER) FROM PUBLIC;
-- GRANT EXECUTE para quironequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (mesmo padrão do ADR-004/006).
