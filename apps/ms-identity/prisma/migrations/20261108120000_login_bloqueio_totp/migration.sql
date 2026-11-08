-- ════════════════════════════════════════════════════════════════
-- Bloqueio progressivo de login e TOTP sem reuso (auditoria 06/11/2026, M-02)
--
-- failed_login_count: falhas seguidas (senha ou TOTP); zera no login certo.
-- locked_until:       a partir da 5ª falha, a conta fica bloqueada por
--                     1, 2, 4... minutos, até 15 (AuthRepository.registerLoginFailure).
-- totp_last_step:     último passo de 30 s de TOTP aceito; código de passo
--                     menor ou igual é recusado (o mesmo código não vale duas vezes).
-- ════════════════════════════════════════════════════════════════

ALTER TABLE "users"
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ,
  ADD COLUMN "totp_last_step" BIGINT;

-- O login precisa ler o bloqueio e o último passo de TOTP antes de existir
-- tenant na sessão: a função de lookup (ADR-004) passa a devolvê-los. Mudar
-- o RETURNS TABLE exige DROP + CREATE; o GRANT EXECUTE para a
-- quironequine_app volta com o 01-create-app-role.sql, que o CI e o deploy
-- rodam depois das migrações.
DROP FUNCTION IF EXISTS auth_lookup_by_email(TEXT);

CREATE FUNCTION auth_lookup_by_email(p_email TEXT)
RETURNS TABLE (
  id                 UUID,
  tenant_id          UUID,
  password_hash      VARCHAR,
  role               "UserRole",
  full_name          VARCHAR,
  totp_secret        VARCHAR,
  totp_enabled       BOOLEAN,
  user_status        "UserStatus",
  tenant_plan        "TenantPlan",
  tenant_status      "TenantStatus",
  failed_login_count INTEGER,
  locked_until       TIMESTAMPTZ,
  totp_last_step     BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.password_hash, u.role, u.full_name,
         u.totp_secret, u.totp_enabled, u.status, t.plan, t.status,
         u.failed_login_count, u.locked_until, u.totp_last_step
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.email = p_email
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_lookup_by_email(TEXT) FROM PUBLIC;
