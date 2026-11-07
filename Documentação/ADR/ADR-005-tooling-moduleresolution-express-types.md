# ADR-005 — Modernização de `moduleResolution` e correção de drift em `@types/express`

| | |
|---|---|
| **ID** | ADR-005 |
| **Título** | Migração para NodeNext + alinhamento de versão de @types/express + override de deepmerge-ts |
| **Data** | Agosto 2026 |
| **Status** | **ACEITO** |
| **Autores** | Marco Túlio S. Oliveira |
| **Relacionado a** | ADR-001 §4 (stack) · ADR-003 Decisão 4 (CommonJS) |
| **Escopo** | Interno da equipe de desenvolvimento |

---

## Decisão 1 — `moduleResolution: "node"` → `"NodeNext"`

### Contexto

`tsconfig.base.json` usava `moduleResolution: "node"`, que a partir do TypeScript 5.x virou alias de `"node10"` — depreciado, será removido no TS 7.0. O VSCode (rodando TS bundled da extensão) já mostra o aviso; o CLI do projeto (TS 5.9.3) também.

### Decisão

`module` e `moduleResolution` migrados juntos para `"NodeNext"` em `tsconfig.base.json` (TypeScript exige que os dois estejam pareados quando um deles é `Node16`/`NodeNext`).

Cogitamos primeiro só suprimir o aviso via `ignoreDeprecations`, mas o valor aceito depende da versão exata do TS rodando (`"5.0"` no CLI do projeto, mas a extensão do VSCode sugeria `"6.0"` — sintoma de versões de TS divergentes entre editor e workspace, resolvido à parte garantindo que o VSCode use `node_modules/typescript` via `TypeScript: Restart TS Server`). Preferimos migrar de verdade a depender de um valor frágil e específico de versão.

### Por que era seguro

Nenhum `package.json` do monorepo tem `"type": "module"` (removido por completo na ADR-003 Decisão 4) — `NodeNext` trata todo `.ts`/`.js` como CommonJS por padrão nesse cenário, igual ao comportamento anterior. Validado com `typecheck`+`build`+testes em todos os workspaces de backend (`shared-types`, `shared-middlewares`, `ms-identity`, `ms-inventory`, `bff`) antes de aceitar.

---

## Decisão 2 — `@types/express` divergente entre workspaces (bug real, não só cosmético)

### Contexto

Migrar para `NodeNext` expôs (não causou) um problema que já existia: `apps/bff` falhava `typecheck` com erros de overload do Express e `Property 'traceId' does not exist on type 'Request'`. Investigando, `express` (runtime) estava correto em `^4.x` em todo o monorepo — mas `@types/express` estava em `^5.0.0` (tipos da v5, que não roda) em `ms-identity`, `ms-inventory` e `shared-middlewares`; só `bff` tinha o `^4.17.21` certo. Drift acidental, provavelmente de um `npm install @types/express` sem versão fixada em algum commit anterior.

Como `shared-middlewares` é compilado com os tipos errados (v5), seu `.d.ts` publicado carrega assinaturas de `Request`/`Response` da v5. Qualquer consumidor com tipos v4 corretos (`bff`) via boundary de pacote via `.d.ts` incompatível.

### Decisão

`@types/express` fixado em `^4.17.21` (igual ao `bff`, que já estava certo) em `ms-identity`, `ms-inventory` e `shared-middlewares`. `npm install` sozinho não limpou cópias aninhadas antigas (`node_modules/<workspace>/node_modules/@types/express@5.0.6`) — precisou remoção manual + edição pontual do `package-lock.json` para essas três entradas específicas antes do npm parar de as recriar.

Também descoberto: `shared-middlewares/src/auth.ts` e `trace.ts` fazem `declare module 'express-serve-static-core'` diretamente, mas nunca declararam `@types/express-serve-static-core` como dependência própria — dependiam de hoisting acidental. Adicionado como devDependency explícita.

### Verificação

`typecheck` + `build` limpos nos 5 workspaces de backend, incluindo `bff` pela primeira vez. Suíte de testes do `ms-identity` (48 testes) sem mudança de resultado.

---

## Decisão 3 — Override de `deepmerge-ts` (vulnerabilidade em dependência do Prisma CLI)

### Contexto

`npm install` (necessário pra Decisão 2) expôs `npm audit --omit=dev` reportando 4 vulnerabilidades altas — pré-existentes no lockfile, não introduzidas por nós. `nanoid` foi resolvido por `npm audit fix` normal. Restou `deepmerge-ts <8.0.0` (stack exhaustion), puxado por `@prisma/config` → `prisma` (CLI, devDependency). Sem fix disponível ainda via `npm audit fix` nem `--force` — bloqueado no upstream do Prisma.

### Decisão

Mesmo padrão da Decisão 3 da ADR-003 (`overrides` no `package.json` raiz para dependência de build sem alcançar produção):

```json
"overrides": { "deepmerge-ts": "^8.0.1" }
```

Validado que `prisma generate` e `prisma migrate status` continuam funcionando normalmente com a versão forçada (major bump 7→8) antes de aceitar.

### Revisão

Remover o override quando `@prisma/config` atualizar sua própria dependência de `deepmerge-ts` para `>=8.0.0` upstream.

---

## Histórico

| Versão | Data | Descrição | Autor |
|---|---|---|---|
| 1.0 | Ago/2026 | Criação. Três decisões de tooling descobertas ao resolver um aviso de depreciação. | Marco Túlio |
