# ADR-004 — Descoberta de tenant pré-login via funções `SECURITY DEFINER`

| | |
|---|---|
| **ID** | ADR-004 |
| **Título** | Bypass controlado de RLS para o lookup de usuário por e-mail no login |
| **Data** | Agosto 2026 |
| **Status** | **ACEITO** |
| **Autores** | Marco Túlio S. Oliveira |
| **Relacionado a** | ADR-001 §5.2 (RLS como fronteira de tenant) · ADR-003 Decisão 1 e 2 · Plano de Trabalho KA Construção, Sprint 2 |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Contexto

O `AuthService` (Sprint 2, `IAuthService.login(email, password, totpCode?)`) recebe apenas um e-mail — descobrir a qual tenant esse usuário pertence **é o próprio propósito da consulta**. Mas a tabela `users` tem RLS ativo (migration `20260728122247_enable_rls`), e a conexão de runtime (`vetequine_app`) não ignora RLS por desenho (ADR-003 Decisão 1). Qualquer consulta a `users` sem `app.current_tenant` definido retorna zero linhas — não há como chegar ao `tenantId` por esse caminho.

A `ADR-003` Decisão 2 resolveu um problema parecido para a tabela `tenants` (sem RLS, "consultada no login antes de existir contexto de tenant"), mas isso não cobre `users`: `tenants` não guarda segredo nenhum, enquanto `users` guarda `password_hash` e `totp_secret` de todos os tenants. Remover RLS de `users` do mesmo jeito seria uma regressão real — qualquer bug futuro que esqueça `withTenant()` em algum lugar do código vazaria credenciais de todos os tenants de uma vez, em vez de falhar fechado (zero linhas, como o RLS garante hoje).

## Decisão

Duas funções PostgreSQL `SECURITY DEFINER`, somente leitura, de propriedade da role de migration (`vetequine`, superusuário — por isso a função ignora RLS independente de quem a chama):

```sql
auth_lookup_by_email(email) → id, tenant_id, password_hash, role, full_name,
                               totp_secret, totp_enabled, user_status,
                               tenant_plan, tenant_status
```
Usada só em `login`. Faz o join `users`/`tenants` e devolve exatamente as colunas que o `AuthService` precisa — nunca `SELECT *`.

```sql
auth_tenant_id_for_user(userId) → tenant_id
```
Usada em `refresh` e `logout`, que recebem apenas o token/`userId` (a assinatura de `IAuthService` não expõe `tenantId` nesses métodos). Devolve só um UUID, nunca a linha inteira.

`vetequine_app` recebe `GRANT EXECUTE` nas duas funções (em `infra/postgres-init/01-create-app-role.sql`, aplicado depois das migrations) — **nunca** `GRANT SELECT` direto nas tabelas. O grant geral (`SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`) continua existindo e continua sob RLS como sempre foi; as funções são a única porta extra, e é uma porta estreita.

A partir do momento em que o `AuthService` tem o `tenantId` em mãos, todo write (gravar `last_login_at`/`refresh_token_hash`, rotacionar token, limpar no logout) volta a passar por `withTenant()` normalmente — não existe nenhum caminho de escrita via `SECURITY DEFINER`.

## Consequências

**Positivas.** O invariante "toda leitura de `users` passa por `withTenant()`" continua verdadeiro para o resto do sistema inteiro — a exceção é só leitura, só essas duas funções, só as colunas que elas explicitamente selecionam. Um revisor futuro tem uma frase simples para verificar: *"bypass = somente leitura, propósito único (descobrir `tenant_id` antes de ele existir); nada além disso."* Se o dono da função for trocado por engano para uma role sem `bypassrls`, o RLS normal volta a valer e a função passa a devolver zero linhas — falha fechado, não aberto.

**Negativas / risco residual.** `auth_tenant_id_for_user` aceita qualquer `userId`, de qualquer tenant — em teoria, alguém com acesso ao SQL de `vetequine_app` (ou seja, código da aplicação já comprometido) poderia limpar o `refresh_token_hash` de um usuário de outro tenant só sabendo o UUID (negação de serviço via logout forçado). Isso é estritamente mais restrito do que o que essa role já pode fazer hoje (CRUD completo no próprio tenant via RLS), e UUIDs não são adivinháveis — mas é uma capacidade cross-tenant nova, por menor que seja.

**Mitigação.** `AuthService.logout` nunca chama `clearRefreshToken` só com base no `userId` resolvido por `auth_tenant_id_for_user` — antes disso, verifica com `bcrypt.compare` que quem está chamando realmente possui o segredo do refresh token daquele usuário. Só invalida a sessão se o segredo bater; caso contrário, é no-op silencioso. Isso fecha a brecha: a função só é útil combinada com posse do token, não com o `userId` sozinho.

## Verificação

Novo teste de integração `apps/ms-identity/tests/auth-lookup.test.ts` (mesmo padrão de duas conexões do `rls-isolation.test.ts`), rodando as funções como `vetequine_app` (não como admin):
- `auth_lookup_by_email` acha usuário existente, retorna vazio para e-mail inexistente e para usuário soft-deletado.
- `SELECT * FROM users` direto continua bloqueado para `vetequine_app` sem tenant definido — prova que a nova função não afrouxou o grant geral.
- `auth_tenant_id_for_user` acha o tenant certo, retorna nulo para usuário inexistente/deletado.

## Revisão

Se o contrato `IAuthService` mudar para receber `tenantId` explicitamente em `refresh`/`logout` (ex.: cliente informa um slug/subdomínio de tenant), `auth_tenant_id_for_user` deixa de ser necessária e pode ser removida — mantendo só `auth_lookup_by_email` para o login.

---

## Histórico

| Versão | Data | Descrição | Autor |
|---|---|---|---|
| 1.0 | Ago/2026 | Criação. Decisão de bypass de RLS para o AuthService (Sprint 2). | Marco Túlio |
