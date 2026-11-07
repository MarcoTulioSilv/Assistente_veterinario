# ADR-006 — Descoberta de tenants ativos para jobs cross-tenant via `SECURITY DEFINER`

| | |
|---|---|
| **ID** | ADR-006 |
| **Título** | Bypass controlado de RLS para o AlertService varrer tenants no ms-inventory |
| **Data** | Setembro 2026 |
| **Status** | **ACEITO** |
| **Autores** | Marco Túlio S. Oliveira (revisão: João Paiva) |
| **Relacionado a** | ADR-001 §5.1/§5.2 (database-per-service, RLS como fronteira de tenant) · ADR-004 (mesmo padrão, aplicado no ms-identity) |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Contexto

`AlertService.checkAllTenants()` (RF-EST-004/005, RN-009) precisa varrer **todos** os tenants que têm produto ativo, uma vez por dia, pra checar validade e estoque baixo. Mas o `ms-inventory` não tem tabela `Tenant` — cada microsserviço tem seu próprio banco (ADR-001 §5.1) — então não há como descobrir a lista de tenants por um join local, e a conexão de runtime (`quironequine_app`) não ignora RLS por desenho.

A primeira versão deste código (PR #9) resolveu isso com `adminPrisma`: um `PrismaClient` inteiro, conectado como o superusuário `quironequine`, exportado como variável de `prisma.ts` e vivo pelo processo inteiro. Revisão do João (PR #9) apontou que isso é mais arriscado que o padrão já estabelecido pela ADR-004 em três eixos:

1. **Amplitude**: `adminPrisma` pode ler/escrever qualquer tabela; a ADR-004 restringe a exatamente as colunas que cada função seleciona.
2. **Ciclo de vida**: `adminPrisma` fica vivo o processo inteiro; uma função SQL só bypassa RLS durante a chamada.
3. **Falha aberta vs fechada**: se um Repository futuro importar `adminPrisma` por engano num caminho HTTP, nada no banco impede — o isolamento de tenant fura silenciosamente. Uma função `SECURITY DEFINER`, se o dono perder `bypassrls`, volta a respeitar RLS e devolve zero linhas — falha fechada.

## Decisão

Reaplicar o padrão da ADR-004: uma função PostgreSQL `SECURITY DEFINER`, somente leitura, de propriedade da role de migration (`quironequine`, superusuário — por isso ignora RLS independente de quem chama):

```sql
inventory_list_active_tenant_ids() → SETOF UUID
```

Devolve só os `tenant_id` distintos de `products` com `deleted_at IS NULL` — nunca `SELECT *`, nunca outra coluna.

`quironequine_app` recebe `GRANT EXECUTE` nessa função (em `infra/postgres-init/01-create-app-role.sql`, mesmo bloco condicional `IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = ...)` já usado pelas funções da ADR-004) — **nunca** acesso direto à tabela além do grant geral já existente (que continua sob RLS).

`adminPrisma` foi removido de `apps/ms-inventory/src/prisma.ts` inteiramente — não existe mais nenhum client Prisma paralelo que bypassa RLS no processo. `ProductRepository.listActiveTenantIds()` chama a função via `prisma.$queryRaw` (o client normal, RLS ativo), exatamente como `AuthRepository` já faz para `auth_lookup_by_email`/`auth_tenant_id_for_user`.

## Consequências

**Positivas.** Mesmo invariante da ADR-004 continua valendo: a exceção ao RLS é só leitura, só esta função, só a coluna que ela seleciona. Não existe mais um client exportado que qualquer código novo poderia importar por engano — o "caminho fácil" (`import { prisma } from '../prisma'`) é o único caminho.

**Negativas / risco residual.** Nenhum identificado além do já aceito na ADR-004: a função roda com privilégio do dono, então qualquer alteração de schema em `products` precisa considerar que esta função também lê a tabela.

## Verificação

Confirmado manualmente: `psql -U quironequine_app -d inventory -c "SELECT inventory_list_active_tenant_ids();"` retorna os tenants esperados, mesmo conectando diretamente como a role restrita (sem passar por `withTenant`) — prova que o bypass está na função, não na conexão. Testes de integração existentes (`tests/product-repository.test.ts`, cobrindo `listActiveTenantIds()`) continuam verdes sem nenhuma mudança de asserção.

## Revisão

Se o `ms-inventory` algum dia ganhar sua própria tabela de tenants (pouco provável, dado o desenho database-per-service), esta função deixa de ser necessária.

---

## Histórico

| Versão | Data | Descrição | Autor |
|---|---|---|---|
| 1.0 | Set/2026 | Criação. Substitui `adminPrisma` (PR #9) por função SECURITY DEFINER, após revisão do João. | Marco Túlio |
