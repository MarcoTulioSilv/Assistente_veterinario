-- Auditoria de 06/11/2026 (A-03 e M-04): uma sessão por aparelho no lugar
-- do refresh token único em `users`.
--
-- Antes, o login num aparelho derrubava o outro, o logout não revogava nada
-- no servidor e duas renovações simultâneas se atropelavam. Agora cada
-- aparelho tem a sua linha; a rotação é um UPDATE condicional (atômico) e
-- um token já rotacionado que volta fora da tolerância revoga a família.
--
-- O segredo é guardado como SHA-256: são 32 bytes aleatórios, não uma
-- senha — bcrypt ali só gastava CPU a cada renovação (M-04).
--
-- As colunas antigas saem: quem estava logado entra de novo uma vez.

CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "secret_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" VARCHAR(20),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_sessions_revoked_reason_check"
      CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('rotated', 'logout', 'reuse')),
    CONSTRAINT "user_sessions_revoked_has_reason"
      CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL))
);

CREATE INDEX "user_sessions_tenant_id_idx" ON "user_sessions"("tenant_id");
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions"("family_id");

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_sessions ON "user_sessions"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "users" DROP COLUMN "refresh_token_hash";
ALTER TABLE "users" DROP COLUMN "refresh_token_expires_at";

-- O refresh chega sem tenant (só o token). Mesmo padrão do ADR-004: uma
-- função SECURITY DEFINER estreita que devolve só o tenant da sessão; a
-- validação do segredo e todo o resto seguem pelo withTenant, com RLS.
-- Substitui auth_tenant_id_for_user, que perdeu o único uso.
CREATE OR REPLACE FUNCTION auth_tenant_id_for_session(p_session_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM user_sessions WHERE id = p_session_id;
$$;

REVOKE ALL ON FUNCTION auth_tenant_id_for_session(UUID) FROM PUBLIC;
-- GRANT EXECUTE para quironequine_app: infra/postgres-init/01-create-app-role.sql.

DROP FUNCTION auth_tenant_id_for_user(UUID);
