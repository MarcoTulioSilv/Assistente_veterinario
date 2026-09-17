# ADR-003 — Decisões de Implementação da Sprint 1

| | |
|---|---|
| **ID** | ADR-003 |
| **Título** | Decisões de implementação surgidas no setup do Marco M1 |
| **Data** | Julho 2026 |
| **Status** | **ACEITO** |
| **Autores** | Marco Túlio S. Oliveira · João L. Paiva |
| **Relacionado a** | ADR-001 (arquitetura) · ERS v1.1 · Plano de Trabalho KA Construção |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Contexto geral

O ADR-001 definiu a arquitetura de microsserviços, a stack e os princípios.
Durante a execução da Sprint 1 (setup do ambiente M1), sete decisões técnicas
precisaram ser tomadas que não estavam previstas — algumas por descoberta de
vulnerabilidades, outras por atrito de ferramentas, outras por falhas do próprio
desenho original.

Este ADR registra todas em um único documento por serem contemporâneas e de
escopo limitado. **ADRs futuros devem tratar uma decisão por documento.**

---

## Decisão 1 — Role dupla no PostgreSQL para RLS efetivo

### Contexto

O ADR-001 §5.2 estabelece Row-Level Security como mecanismo de isolamento
multitenancy (RNF-SEG-004). Durante a implementação descobrimos que o usuário
criado pelo `POSTGRES_USER` do Docker é **superusuário**, e superusuários no
PostgreSQL **ignoram RLS por padrão** (`rolbypassrls = true`).

Isso significa que, com a configuração original, as políticas de RLS estariam
aplicadas no banco mas não protegeriam nada em runtime. A falha é silenciosa:
nenhum erro, nenhum log, apenas vazamento de dados entre tenants.

### Decisão

Duas conexões distintas por microsserviço:

| Conexão | Role | Uso | Variável |
|---|---|---|---|
| Migrations | `quironequine` (superusuário) | `prisma migrate`, DDL, criação de policies | `DATABASE_URL_<MS>` |
| Runtime | `quironequine_app` (role comum) | Prisma Client em produção | `DATABASE_URL_<MS>_APP` |

A role de aplicação é criada por `infra/postgres-init/01-create-app-role.sql`,
que roda **depois** das migrations (o `GRANT ON ALL TABLES` só alcança tabelas
existentes). O `ALTER DEFAULT PRIVILEGES` garante que migrations futuras
concedam permissão automaticamente.

O `src/prisma.ts` lança erro no boot se `DATABASE_URL_<MS>_APP` estiver ausente,
para evitar fallback silencioso.

### Consequências

**Positivas.** O isolamento passa a ser garantido pelo banco, não pela disciplina
do código. Mesmo um `WHERE` esquecido em um Repository não vaza dados.

**Negativas.** Duas variáveis de ambiente por microsserviço. O `.env.example`
e a documentação de deploy precisam refletir isso. Em produção, a senha da role
de aplicação vira mais um secret a gerenciar.

### Verificação

O teste `tests/rls-isolation.test.ts` valida no CI que a conexão de runtime não
é superusuária, que cada tenant vê apenas os próprios dados, e que toda tabela
com coluna `tenant_id` possui policy correspondente.

---

## Decisão 2 — Tabela `tenants` sem RLS

### Contexto

A tabela `tenants` é a raiz da hierarquia multitenancy. Durante o login, o
`AuthService` precisa consultá-la para descobrir a qual tenant o usuário
pertence — mas nesse momento ainda não existe contexto de tenant definido.

Com RLS ativo e `app.current_tenant` vazio, a consulta retornaria zero linhas
e o login nunca funcionaria.

### Decisão

`tenants` **não** recebe policy de RLS. O controle de acesso a ela fica na
camada de aplicação, dentro do `AuthService`.

Todas as demais tabelas com `tenant_id` têm RLS obrigatório.

### Consequências

**Positivas.** O fluxo de autenticação funciona sem exceções ou contornos.

**Negativas.** O `AuthService` vira ponto crítico de segurança. Qualquer
endpoint que consulte `tenants` fora dele precisa de revisão explícita em
code review.

**Mitigação.** Nenhum Controller expõe `tenants` diretamente. O acesso é
restrito ao `AuthService` e ao `TenantService`, ambos cobertos por testes.

---

## Decisão 3 — Overrides de dependências vulneráveis

### Contexto

Auditoria inicial do monorepo retornou 54 vulnerabilidades, sendo 51 de
severidade alta. Após refatoração (Decisões 5 e 6), restaram 3 com origem no
próprio Next.js:

- O Next fixa `postcss@8.4.31` internamente — três advisories ativas
  (XSS via `</style>`, leitura arbitrária e path traversal via `sourceMappingURL`).
  Registrado como issue aberta em `vercel/next.js#93234`.
- O Next depende de versão de `sharp` anterior à 0.35.0, afetada por quatro
  CVEs herdadas do libvips nos loaders GIF, TIFF e VIPS.

O `npm audit fix --force` propunha rebaixar o Next para a versão 9.3.3 (de 2020),
o que era inviável.

### Decisão

Bloco `overrides` no `package.json` da raiz:

```json
"overrides": {
  "postcss": "^8.5.23",
  "sharp": "^0.35.3"
}
```

O CI passa a ter dois níveis de auditoria:

- `npm audit --omit=dev --audit-level=high` — **bloqueia** o merge
- `npm audit --audit-level=high` — informativo, `continue-on-error: true`

### Consequências

**Positivas.** Zero vulnerabilidades. Independência do cronograma de correções
do Vercel.

**Negativas.** Estamos forçando o Next a usar versões que ele não testou.
Risco baixo (mesma major, API estável), mas exige verificar o build a cada
upgrade.

**Flexibilização registrada.** O Plano de Trabalho §8 determina que "CVE crítica
bloqueia o merge automaticamente". A separação entre audit de produção e audit
completo é uma exceção consciente: vulnerabilidades em ferramentas de build não
alcançam o servidor.

### Revisão

**A cada upgrade de major do Next.js.** Se o Vercel atualizar os pins internos,
os overrides devem ser removidos — mantê-los indefinidamente impede que
correções upstream cheguem.

---

## Decisão 4 — CommonJS como sistema de módulos do backend

### Contexto

A refatoração de segurança introduziu `"type": "module"` nos `package.json`
sem ajustar o `tsconfig.base.json`, que continuava emitindo `"module": "CommonJS"`.
O resultado foi código CJS interpretado como ESM — `ReferenceError: exports is not defined`.

Era preciso escolher um dos dois consistentemente.

### Decisão

**CommonJS** no backend e nos pacotes compartilhados. O campo `"type": "module"`
foi removido de todos os `package.json`; o `tsconfig.base.json` mantém
`"module": "CommonJS"`.

O código-fonte continua escrito com sintaxe ESM (`import`/`export`).
Apenas a saída compilada é CJS.

Exceções que permanecem ESM: `eslint.config.mjs` (a extensão `.mjs` força ESM,
exigido pelo flat config do ESLint 9), `vitest.config.ts` e `next.config.ts`
(transformados pelos próprios pipelines antes da execução).

### Consequências

**Positivas.** Zero atrito com Express, Prisma, BullMQ e o ecossistema Node
majoritário. Sem necessidade de extensão `.js` explícita em imports relativos.
`__dirname` e `require` continuam disponíveis.

**Negativas.** Pacotes publicados exclusivamente como ESM não podem ser
importados estaticamente.

**Mitigação.** Nesses casos, usar `await import()` dinâmico dentro de função
async. Se a frequência aumentar, reavaliar a migração para ESM.

---

## Decisão 5 — PWA sem plugin: Service Worker próprio

### Contexto

O `next-pwa` original está arquivado desde 2022 e arrastava uma árvore de
dependências antigas (Workbox 6, glob 7, rimraf 2/3, inflight) responsável por
boa parte das 51 vulnerabilidades iniciais.

O fork mantido `@ducanh2912/next-pwa` continuava dependendo de `workbox-build`,
que puxa `@rollup/plugin-terser` → `serialize-javascript` (RCE).

O Serwist, sucessor moderno, exige Webpack — enquanto o Next 16 usa Turbopack
por padrão.

### Decisão

Remover o plugin. O Service Worker é escrito à mão em `apps/pwa/public/sw.js`
(~185 linhas), com três estratégias de cache:

| Recurso | Estratégia | Motivo |
|---|---|---|
| App shell | Cache First | assets estáticos, raramente mudam |
| `/api/v1/(owners\|properties\|animals\|inventory)` | Network First | RNF-DIS-002: leitura offline em campo |
| Navegação | Network First + fallback `/offline` | UX degradada mas funcional |

O manifest passa a ser gerado nativamente pelo App Router
(`apps/pwa/src/app/manifest.ts`), substituindo o `public/manifest.json` estático.

O registro do SW fica em `ServiceWorkerRegistration.tsx`, que também notifica
o usuário quando há nova versão disponível.

### Consequências

**Positivas.** Eliminação completa da árvore Workbox. Controle total sobre o
comportamento offline — que é requisito central (RNF-DIS-002) para uso em campo.
Sem dependência de plugin não mantido.

**Negativas.** 185 linhas a mais para manter e testar. A equipe precisa entender
a Service Worker API.

**Escopo futuro.** O handler de `push` já está implementado (RF-NOT-001), mas só
será exercitado no M3, quando o Notification Service existir.

---

## Decisão 6 — Vitest no lugar de Jest

### Contexto

`jest` → `@jest/reporters` → `glob` → `minimatch` → `brace-expansion`, este
último com CVE de DoS por expansão ilimitada. O `ts-jest` e o `babel-jest`
ampliavam ainda mais a árvore.

### Decisão

Substituir Jest por **Vitest** em todos os workspaces de backend.

### Consequências

**Positivas.** Elimina a cadeia vulnerável. Executa TypeScript nativamente —
sem `ts-jest` nem `babel-jest`. Execução mais rápida. API compatível com Jest
(`describe`, `it`, `expect`), o que tornou a migração dos testes existentes
praticamente literal.

**Negativas.** Ecossistema menor que o do Jest. Alguns utilitários de mock têm
API ligeiramente diferente.

**Configuração.** `vitest.config.ts` por workspace, com `fileParallelism: false`
nos que têm testes de integração (compartilham banco). O threshold de cobertura
de 70% (RNF-MAN-003) é aplicado via `coverage.thresholds`.

---

## Decisão 7 — `dotenv-cli` para carregar variáveis em monorepo

### Contexto

O Prisma procura o `.env` no diretório de invocação. Com
`npm run db:migrate --workspace=@quironequine/ms-identity`, o `cwd` passa a ser
`apps/ms-identity`, onde não existe `.env` — resultando em `P1012:
Environment variable not found`.

Manter um `.env` por workspace duplicaria segredos e violaria a regra de
fonte única.

### Decisão

`dotenv-cli` como devDependency de cada microsserviço, aplicado nos scripts que
leem variáveis em runtime:

```json
"db:migrate": "dotenv -e ../../.env -- prisma migrate dev"
```

Scripts que operam apenas sobre arquivos (`build`, `lint`, `typecheck`, `clean`)
não recebem o wrapper.

Para testes de integração, o `.env` é carregado dentro do próprio
`vitest.config.ts` via `dotenv/config`.

### Consequências

**Positivas.** Um único `.env` na raiz. Comandos funcionam de qualquer
diretório.

**Negativas.** Mais um nível de indireção nos scripts. No CI o `dotenv-cli` é
inofensivo — não encontra o arquivo e segue com as variáveis já presentes no
ambiente.

---

## Nota operacional — encoding em ambiente Windows

Não é uma decisão arquitetural, mas custou tempo de depuração e vale registrar.

O PowerShell 5.1 grava UTF-8 **com BOM** ao usar `Set-Content -Encoding UTF8`.
O PostgreSQL rejeita o BOM com `syntax error at or near "﻿"`.

Ao gerar arquivos `.sql` por script no Windows, usar:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
```

O `.vscode/settings.json` do projeto força `"files.encoding": "utf8"` e
`"files.eol": "\n"` para prevenir o problema em arquivos criados manualmente.

---

## Impacto no ADR-001

As decisões 4, 5 e 6 alteram a tabela de stack do ADR-001 §4. As mudanças estão
consolidadas no adendo `ADR-001-adendo-stack-julho-2026.md`.

---

## Histórico

| Versão | Data | Descrição | Autor |
|---|---|---|---|
| 1.0 | Jul/2026 | Criação. Sete decisões da Sprint 1 do Marco M1. | Marco Túlio / João Paiva |
