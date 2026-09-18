-- ══════════════════════════════════════════════════════════════════
-- Quíron Equine -- Criacao da role de aplicacao
--
-- POR QUE ISTO EXISTE:
-- O usuario `quironequine` (POSTGRES_USER do Docker) e SUPERUSUARIO,
-- e superusuarios IGNORAM Row-Level Security. Se a aplicacao
-- conectar com ele, o isolamento entre tenants fica furado --
-- sem erro, sem aviso, silenciosamente.
--
-- Duas conexoes distintas:
--   quironequine      -> migrations (cria tabelas e policies)
--   quironequine_app  -> runtime    (role comum, sujeita ao RLS)
--
-- QUANDO RODAR: depois das migrations.
--   GRANT ON ALL TABLES so alcanca tabelas que ja existem.
--
-- ONDE RODAR: em CADA container de banco.
--   Sao clusters PostgreSQL independentes; roles nao sao
--   compartilhadas entre eles.
--
-- Refs: ADR-001 5.2 / RNF-SEG-004 / Contrato Clausula 10a
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. Criar a role (idempotente) ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quironequine_app') THEN
    CREATE ROLE quironequine_app WITH LOGIN PASSWORD 'app_dev_password';
    RAISE NOTICE 'Role quironequine_app criada.';
  ELSE
    RAISE NOTICE 'Role quironequine_app ja existia -- nada a fazer.';
  END IF;
END
$$;

-- ─── 2. Permissao de conexao ──────────────────────────────────────
-- CURRENT_CATALOG nao funciona em GRANT ON DATABASE: essa clausula
-- exige um identificador literal, nao uma expressao. Usamos EXECUTE
-- com format(%I) para montar o comando com o nome real do banco --
-- assim o mesmo arquivo serve para os 7 microsservicos.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO quironequine_app', current_database());
  RAISE NOTICE 'CONNECT concedido no banco %.', current_database();
END
$$;

-- ─── 3. Permissoes no schema ──────────────────────────────────────
GRANT USAGE ON SCHEMA public TO quironequine_app;

-- Tabelas e sequences que JA existem
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quironequine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quironequine_app;

-- Tabelas e sequences FUTURAS -- as proximas migrations herdam
-- automaticamente, sem precisar rodar este arquivo de novo.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quironequine_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quironequine_app;

-- ─── 4. Funcoes de auth pre-tenant (SECURITY DEFINER) ─────────────
-- So EXECUTE, nunca SELECT direto -- ver ADR-004 e a migration
-- 20260813192902_auth_refresh_and_lookup. So existem no banco do
-- identity; nos demais bancos este GRANT falharia -- rode este
-- arquivo so apos as migrations do servico correspondente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_lookup_by_email') THEN
    GRANT EXECUTE ON FUNCTION auth_lookup_by_email(TEXT)    TO quironequine_app;
    GRANT EXECUTE ON FUNCTION auth_tenant_id_for_user(UUID) TO quironequine_app;
  END IF;
END
$$;

-- ─── 4b. Funcao de descoberta de tenants pro AlertService (SECURITY DEFINER) ──
-- ADR-006 (reaplica o padrao do ADR-004). So existe no banco do
-- inventory -- rode este arquivo so apos as migrations correspondentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'inventory_list_active_tenant_ids') THEN
    GRANT EXECUTE ON FUNCTION inventory_list_active_tenant_ids() TO quironequine_app;
  END IF;
END
$$;

-- ─── 5. Confirmacao ───────────────────────────────────────────────
-- As duas colunas devem ser 'f' na linha do quironequine_app.
-- Se 'ignora_rls' for 't', as policies seriam decorativas.
SELECT
  rolname      AS role,
  rolsuper     AS eh_superusuario,
  rolbypassrls AS ignora_rls,
  rolcanlogin  AS pode_logar
FROM pg_roles
WHERE rolname LIKE 'quironequine%'
ORDER BY rolname;