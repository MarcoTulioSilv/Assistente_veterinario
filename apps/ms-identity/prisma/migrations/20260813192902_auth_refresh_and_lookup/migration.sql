-- AlterTable
ALTER TABLE "users" ADD COLUMN     "refresh_token_expires_at" TIMESTAMPTZ;

-- ══════════════════════════════════════════════════════════════════
-- Funcoes de descoberta de tenant pre-autenticacao (ADR-004)
--
-- Excecao documentada ao invariante "toda leitura de users passa por
-- withTenant()" (ADR-001 5.2). Login recebe so o e-mail -- descobrir
-- o tenant E o proposito da consulta, entao nao ha como definir
-- app.current_tenant antes dela.
--
-- Por que funciona sem furar RLS para o resto do sistema: a funcao
-- roda com os privilegios do DONO (SECURITY DEFINER), nao de quem
-- chama. O dono e a role de migration (quironequine, superusuario,
-- bypassrls=true por natureza) -- por isso a funcao ignora RLS, mas
-- so devolve exatamente as colunas que o corpo seleciona. quironequine_app
-- recebe GRANT EXECUTE nestas funcoes (ver 01-create-app-role.sql),
-- nunca GRANT SELECT direto nas tabelas -- esse grant continua
-- restrito por RLS como sempre foi.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_lookup_by_email(p_email TEXT)
RETURNS TABLE (
  id             UUID,
  tenant_id      UUID,
  password_hash  VARCHAR,
  role           "UserRole",
  full_name      VARCHAR,
  totp_secret    VARCHAR,
  totp_enabled   BOOLEAN,
  user_status    "UserStatus",
  tenant_plan    "TenantPlan",
  tenant_status  "TenantStatus"
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.role, u.full_name,
         u.totp_secret, u.totp_enabled, u.status, t.plan, t.status
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = p_email
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

-- Usada só por refresh()/logout(), que recebem apenas o token/userId,
-- nunca o tenantId (IAuthService nao o expoe nessas assinaturas).
-- Devolve o minimo possivel (um UUID), nunca dados sensiveis.
CREATE OR REPLACE FUNCTION auth_tenant_id_for_user(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM users WHERE id = p_user_id AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auth_lookup_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_tenant_id_for_user(UUID) FROM PUBLIC;
-- GRANT EXECUTE para quironequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (a role pode nao existir ainda neste ponto).
