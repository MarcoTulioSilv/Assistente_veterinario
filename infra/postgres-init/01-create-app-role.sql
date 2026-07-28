-- ══════════════════════════════════════════════════════════════════
-- VetEquine -- Criacao da role de aplicacao
--
-- POR QUE ISTO EXISTE:
-- O usuario `vetequine` (POSTGRES_USER do Docker) e SUPERUSUARIO,
-- e superusuarios IGNORAM Row-Level Security. Se a aplicacao
-- conectar com ele, o isolamento entre tenants fica furado --
-- sem erro, sem aviso, silenciosamente.
--
-- Duas conexoes distintas:
--   vetequine      -> migrations (cria tabelas e policies)
--   vetequine_app  -> runtime    (role comum, sujeita ao RLS)
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vetequine_app') THEN
    CREATE ROLE vetequine_app WITH LOGIN PASSWORD 'app_dev_password';
    RAISE NOTICE 'Role vetequine_app criada.';
  ELSE
    RAISE NOTICE 'Role vetequine_app ja existia -- nada a fazer.';
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
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO vetequine_app', current_database());
  RAISE NOTICE 'CONNECT concedido no banco %.', current_database();
END
$$;

-- ─── 3. Permissoes no schema ──────────────────────────────────────
GRANT USAGE ON SCHEMA public TO vetequine_app;

-- Tabelas e sequences que JA existem
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vetequine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vetequine_app;

-- Tabelas e sequences FUTURAS -- as proximas migrations herdam
-- automaticamente, sem precisar rodar este arquivo de novo.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vetequine_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vetequine_app;

-- ─── 4. Confirmacao ───────────────────────────────────────────────
-- As duas colunas devem ser 'f' na linha do vetequine_app.
-- Se 'ignora_rls' for 't', as policies seriam decorativas.
SELECT
  rolname      AS role,
  rolsuper     AS eh_superusuario,
  rolbypassrls AS ignora_rls,
  rolcanlogin  AS pode_logar
FROM pg_roles
WHERE rolname LIKE 'vetequine%'
ORDER BY rolname;