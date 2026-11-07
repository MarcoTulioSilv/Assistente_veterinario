-- ════════════════════════════════════════════════════════════════
-- Trilha de auditoria (auditoria 06/11/2026, M-06; LGPD art. 37)
--
-- Mesmo formato do audit_log do MS1. Gravada por writeAudit()
-- (shared-middlewares) na transação do withTenant, com os NOMES dos campos
-- alterados, nunca os valores. A role da aplicação só tem SELECT/INSERT
-- (infra/postgres-init/01-create-app-role.sql, seção 3d).
-- ════════════════════════════════════════════════════════════════

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
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_table_name_record_id_idx" ON "audit_log"("tenant_id", "table_name", "record_id");


-- RLS: mesmo padrão das demais tabelas (USING vale também como WITH CHECK,
-- então o INSERT só passa com o tenant da sessão).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_log ON audit_log
  USING (tenant_id = current_tenant_id());
