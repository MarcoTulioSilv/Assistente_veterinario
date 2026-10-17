# MS3 — Revisão de performance e segurança (Sprint 8, homologação M2)

| | |
|---|---|
| **Data** | Outubro/2026 |
| **Responsável** | Marco Túlio (Dev 1) |
| **Escopo** | MS3 Clinical (atendimento, exames, vacinação). Os itens de banco e de CI valem para todos os serviços |
| **Itens do Plano de Trabalho** | Sprint 8: "Ajuste de performance: índices, queries N+1 pelo Prisma em MS3" e "Revisão de segurança: RLS tests, secrets no CI, npm audit em MS3" |

## 1. Performance

### Como foi medido
O script [`apps/ms-clinical/scripts/perf-explain.ts`](../apps/ms-clinical/scripts/perf-explain.ts) executa a medição em quatro passos:
1. Cria volume sintético em 10 tenants: atendimentos com itens, exames com animais, vacinações com animais. O rebanho é próprio de cada clínica, com cerca de 15 vacinações por animal.
2. Chama os **repositórios de verdade**, com RLS ativo e com a conexão do runtime (`quironequine_app`).
3. Captura o SQL que o Prisma gera e roda `EXPLAIN ANALYZE` em cada consulta.
4. Apaga o volume no fim.

Para repetir antes de cada homologação:

```bash
cd apps/ms-clinical
PERF_ROWS=50000 npx dotenv -e ../../.env -- tsx scripts/perf-explain.ts   # 500 mil linhas por tabela
```

Use só em banco local: o script grava e apaga dados de tenants sintéticos.

### N+1
**Não há.** As listagens usam `include` do Prisma, que busca as relações em uma consulta por relação (`WHERE id IN (...)`), e não uma por linha. Os laços que aparecem no código percorrem eventos dentro da mesma transação ou linhas já carregadas. O relay do outbox marca um evento por vez de propósito (publica e só depois marca) e trabalha em lotes de 50.

### Achados e correções
Os números abaixo foram medidos com 500 mil linhas por tabela (50 mil por clínica), salvo indicação.

| Consulta | Antes | Depois | O que mudou |
|---|---|---|---|
| Lista de exames, página 1 | 30 ms | 0,08 ms | Índice `(tenant_id, created_at desc)`. Antes, o Postgres ordenava todos os exames da clínica para devolver 20 |
| Lista de vacinações, página 1 | 30 ms | 0,07 ms | Índice `(tenant_id, applied_at desc, created_at desc)` |
| Lista de atendimentos, página 1 | 1,4 ms | 0,08 ms | Índice `(tenant_id, performed_at desc)`. O índice antigo de `performed_at` não tinha tenant e ficaria mais lento a cada clínica nova |
| Lembrete de re-vacinação (job diário) | 1,6 s + **~115 MB de disco temporário por execução** | 0,9 s, sem disco temporário | Ver abaixo |
| Consultas por animal (histórico, próxima dose) | < 1 ms | < 1 ms | Já usavam o índice de `animal_id` |

**Lembrete de re-vacinação.** Para saber se um animal "já foi re-vacinado", o `NOT EXISTS` virava um *hash anti-join* contra **todas** as vacinações de **todos** os tenants. O Postgres montava uma tabela hash da base inteira a cada execução e ela transbordava para o disco. O custo crescia com o tamanho total da tabela, não com o que vencia no dia. Duas mudanças resolveram:
- a função passou a usar `LATERAL ... LIMIT 1`, que procura a re-vacinação animal por animal pelo índice;
- o service passou a pedir só as janelas de **hoje** e de **hoje + 7**, em vez de 11 dias corridos.

O custo agora acompanha só as vacinas que vencem naqueles dias.

Os índices novos substituem os índices simples de `tenant_id` dessas três tabelas. O índice composto cobre o mesmo filtro, e manter os dois só encareceria as escritas. A mudança está na migration `20261017120000_ms3_performance`.

### O que ficou como está
- **Contagem da paginação (`count`):** cerca de 11 ms com 50 mil registros numa clínica. Ela precisa contar todas as linhas do filtro. Com volume realista (alguns milhares por clínica), fica abaixo de 1 ms. Se um dia pesar, a saída é paginação por cursor, que muda o contrato com o PWA.
- **Lembrete de exame:** cerca de 140 ms com 25 mil resultados na janela. Não tem subconsulta, e o índice de `expected_result_at` já atende.

## 2. Segurança

### RLS
**Situação verificada no banco** (MS1, MS2, MS3 e MS6):
- toda tabela de dados tem RLS ativo e uma política `tenant_id = current_tenant_id()`;
- a conexão do runtime não é superusuário, não tem `bypassrls` e não é dona de nenhuma tabela. O dono é o usuário das migrations, então o RLS vale para ela mesmo sem `FORCE`;
- a política sem `WITH CHECK` usa a mesma condição para escrita, ou seja, também barra **gravação** em nome de outro tenant;
- a função `current_tenant_id()` é `STABLE`, o que permite ao Postgres usar índice com o filtro do RLS.

Há duas exceções, e são esperadas: `_prisma_migrations` (controle interno do Prisma) e `identity.tenants` (lookup pré-login, ADR-004).

**Achado corrigido: a aplicação tinha `INSERT`/`DELETE` em `_prisma_migrations`.**
- **Causa:** o `GRANT ... ON ALL TABLES` do script da role alcançava também essa tabela, nos quatro bancos.
- **Risco:** uma falha que permitisse SQL arbitrário poderia adulterar o histórico de migrations.
- **Correção:** o bloco 3b do [`01-create-app-role.sql`](../infra/postgres-init/01-create-app-role.sql) revoga tudo da aplicação nessa tabela. **Em banco existente, rode o script de novo** (ele é idempotente).

**Novo teste de proteção:** [`apps/ms-clinical/tests/rls-guard.test.ts`](../apps/ms-clinical/tests/rls-guard.test.ts). Ele falha se:
- qualquer tabela, **inclusive uma criada no futuro**, ficar sem RLS ou sem política;
- a conexão do runtime puder contornar o RLS ou alcançar o histórico de migrations;
- um tenant conseguir gravar uma linha com o `tenant_id` de outro, ou mover uma linha para outro tenant;
- uma consulta sem tenant no contexto enxergar alguma linha (o esperado é falhar fechado e não ver nada).

Para conferir que o teste não passa por acaso, desliguei o RLS de uma tabela e devolvi a permissão na `_prisma_migrations`: ele falhou nos dois pontos e voltou a passar depois de desfazer.

### Secrets
- **Histórico do git:** todo o histórico foi varrido com o gitleaks 8.30.1. Houve dois achados, ambos falsos positivos: senhas fictícias de fixture de teste do ms-identity. Eles estão registrados no [`.gitleaksignore`](../.gitleaksignore) por commit e linha, e não por arquivo inteiro, então um segredo novo no mesmo arquivo ainda é pego.
- **Arquivos versionados:** o único `.env` no repositório é o `.env.example`.
- **Credenciais nos workflows:** são de bancos Postgres descartáveis, criados e destruídos dentro do próprio job, sem nenhum serviço real por trás. Ainda não há deploy, por isso nenhum `secrets.*` é usado.
- **Novo workflow [`secret-scan.yml`](../.github/workflows/secret-scan.yml):** roda o gitleaks sobre o histórico inteiro em todo PR e em todo push para `main` e `develop`, sem filtro de caminho.
- **Pendência para o staging:** a senha da `quironequine_app` está fixa no script da role (`app_dev_password`) e serve só para desenvolvimento e CI. No staging e na produção, troque com `ALTER ROLE quironequine_app PASSWORD '...'`, usando um valor de secret. Isso está no manual de implantação do MS3.

### npm audit
- **Produção (o que bloqueia o CI, via `audit-ci`):** passa. Nenhum alerta vem de dependência de produção do MS3.
- **Corrigido nesta revisão:** `fast-copy` 4.0.4 → 4.2.0, alerta moderado (via `pino-pretty`). A correção usa `overrides` no `package.json` raiz, o mesmo padrão do `proxy-addr`/`source-map-js`.
- **Restante no audit completo (8 alertas):**
  - cadeia do `braces` (`http-proxy-middleware` no BFF; `tailwindcss` 3 no build do PWA): já na exceção do `.audit-ci.json`, sem correção publicada;
  - `postcss-selector-parser`/`postcss-nested`: a correção exige o Tailwind 4, uma versão major, que é decisão da camada de UI.
