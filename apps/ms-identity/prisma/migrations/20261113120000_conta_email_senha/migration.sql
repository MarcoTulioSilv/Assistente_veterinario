-- ════════════════════════════════════════════════════════════════
-- Confirmação de e-mail e recuperação de senha (auditoria 06/11/2026, M-02)
-- Sprint 10 do M3 — o e-mail é enviado pelo MS5 (ADR-007).
--
-- email_verified_at: confirmação do e-mail do cadastro. Os usuários que já
--   existem contam como confirmados (preenchido abaixo): ligar a confirmação
--   depois não pode trancar ninguém que já usa o sistema.
-- user_tokens: tokens de uso único da conta. Só o SHA-256 fica aqui; o token
--   cru vai no link do e-mail.
-- ════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "UserTokenPurpose" AS ENUM ('verify_email', 'reset_password');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "UserTokenPurpose" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_tenant_id_idx" ON "user_tokens"("tenant_id");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_purpose_idx" ON "user_tokens"("user_id", "purpose");

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Quem já existia conta como confirmado.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;

ALTER TABLE "user_tokens"
  ADD CONSTRAINT "user_tokens_used_after_created" CHECK ("used_at" IS NULL OR "used_at" >= "created_at");

-- RLS: mesmo padrão das demais tabelas do MS1.
ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_tokens ON user_tokens
  USING (tenant_id = current_tenant_id());

-- Trocar a senha encerra as sessões de todos os aparelhos: novo motivo de
-- revogação.
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_revoked_reason_check";
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_revoked_reason_check"
  CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN ('rotated', 'logout', 'reuse', 'password_reset'));

-- ─── Token chega antes do login (ADR-004) ──────────────────────────
-- Quem abre o link não está logado: não há tenant na sessão. A função
-- devolve só o necessário para achar o tenant do token; o consumo (UPDATE
-- condicional) acontece depois, dentro do withTenant, com RLS.
CREATE OR REPLACE FUNCTION auth_find_user_token(p_hash TEXT)
RETURNS TABLE (
  id         UUID,
  tenant_id  UUID,
  user_id    UUID,
  purpose    "UserTokenPurpose",
  expires_at TIMESTAMPTZ,
  used_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.tenant_id, t.user_id, t.purpose, t.expires_at, t.used_at
  FROM user_tokens t
  WHERE t.token_hash = p_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_find_user_token(TEXT) FROM PUBLIC;
-- GRANT EXECUTE para quironequine_app fica em infra/postgres-init/01-create-app-role.sql.
