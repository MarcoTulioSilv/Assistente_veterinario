-- ══════════════════════════════════════════════════════════════════
-- Descoberta de tenants ativos para jobs cross-tenant (ADR-006)
--
-- Reaplica o padrao do ADR-004 (ms-identity): em vez de um Prisma
-- client de superusuario vivendo no processo (bypassa RLS em QUALQUER
-- tabela, indefinidamente), uma funcao SECURITY DEFINER estreita, so
-- leitura, que devolve exatamente o que o AlertService precisa pra
-- varrer todos os tenants (nao existe tabela Tenant neste banco --
-- database-per-service, ADR-001 5.1).
--
-- Por que funciona sem furar RLS pro resto do sistema: a funcao roda
-- com os privilegios do DONO (vetequine, superusuario), nao de quem
-- chama. Se o dono da funcao perder bypassrls, ela volta a respeitar
-- RLS e devolve zero linhas -- falha fechada, nao aberta. Contraste
-- com um client Prisma paralelo: nao ha nada no banco protegendo
-- contra um Repository futuro importar o client errado por engano.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION inventory_list_active_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT tenant_id FROM products WHERE deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION inventory_list_active_tenant_ids() FROM PUBLIC;
-- GRANT EXECUTE para vetequine_app fica em infra/postgres-init/01-create-app-role.sql,
-- que roda depois das migrations (mesmo padrao do ADR-004).
