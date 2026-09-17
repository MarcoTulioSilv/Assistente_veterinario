# Onboarding — Ambiente de Desenvolvimento Quíron Equine

Guia para colocar a máquina de um desenvolvedor no mesmo estado do ambiente
de referência. Tempo estimado: **40 a 60 minutos**, sendo a maior parte
download de dependências.

> **Antes de começar:** leia o `docs/adr/ADR-001` (arquitetura) e o
> `Plano de Trabalho — KA Construção` (divisão de tarefas). Este guia assume
> que você já sabe o que são os 7 microsserviços e por que existem.

---

## 1. Pré-requisitos

Instale e confirme cada item **antes** de clonar o repositório.

| Ferramenta | Versão mínima | Como verificar |
|---|---|---|
| Node.js | 20.0.0 | `node --version` |
| npm | 10.0.0 | `npm --version` |
| Docker Desktop | recente | `docker --version` |
| Docker Compose | v2 | `docker compose version` |
| Git | qualquer | `git --version` |

### Node.js

Se a versão for inferior a 20, instale via [nvm-windows](https://github.com/coreybutler/nvm-windows):

```powershell
nvm install 20
nvm use 20
```

### Docker Desktop

Precisa estar **rodando**, não só instalado. No Windows, confirme que o WSL 2
está ativo em Settings → General → "Use WSL 2 based engine".

Teste:

```powershell
docker run --rm hello-world
```

Se imprimir "Hello from Docker!", está pronto. Se travar ou der erro, resolva
isso antes de seguir — nada mais vai funcionar.

### Editor

VS Code recomendado. O repositório traz `.vscode/settings.json` que força
UTF-8 sem BOM e quebra de linha LF — importante para arquivos `.sql`
(ver Troubleshooting §8.4).

Extensões úteis: Prisma, ESLint, Prettier, Docker.

---

## 2. Clonar o repositório

```powershell
cd C:\Users\SEU_USUARIO\Desktop
git clone https://github.com/MarcoTulioSilv/Assistente_veterinario.git quironequine
cd quironequine
```

Confirme as branches:

```powershell
git branch -a
```

Você deve ver `main`, `develop` e `staging` no remoto.

Trabalhe sempre a partir de `develop`:

```powershell
git checkout develop
```

---

## 3. Instalar dependências

```powershell
npm install
```

Demora de 2 a 4 minutos na primeira vez. O npm lê os `workspaces` do
`package.json` raiz e instala tudo numa única pasta `node_modules`.

Um hook `postinstall` builda `shared-types` e `shared-middlewares`
automaticamente logo em seguida (você vai ver `turbo run build...` rodar
sozinho) — os dois publicam `dist/` via `main`/`types` no `package.json`,
e essa pasta é gitignorada, então precisa existir antes de qualquer outro
comando (`dev`, `test`, `typecheck`) funcionar. Se um dia isso não rodar
sozinho (ex.: `npm ci --ignore-scripts`), rode
`npx turbo run build --filter=@quironequine/shared-types --filter=@quironequine/shared-middlewares`
manualmente.

### Confirmar que os workspaces foram vinculados

```powershell
Get-ChildItem node_modules\@quironequine
```

Devem aparecer `shared-types` e `shared-middlewares` como links simbólicos
para as pastas em `packages/`. É isso que permite o `import` entre pacotes.

### Auditoria de segurança

```powershell
npm audit
```

**Deve retornar zero vulnerabilidades.** O `package.json` raiz tem um bloco
`overrides` que força versões corrigidas de `postcss` e `sharp` — o Next.js
fixa versões vulneráveis internamente (ver `ADR-003` §3).

Se aparecer alguma vulnerabilidade, **não rode `npm audit fix --force`** —
ele propõe rebaixar o Next para a versão 9.3.3, de 2020. Avise o time.

---

## 4. Configurar o `.env`

O `.env` **não está no repositório** e nunca deve estar. Cada desenvolvedor
cria o seu.

```powershell
Copy-Item .env.example .env
```

### Gerar o JWT_SECRET

Precisa ter no mínimo 32 caracteres — o middleware de auth lança erro se for
menor.

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Cole o resultado na linha `JWT_SECRET=` do `.env`.

> Não peça o secret de outro dev. Em ambiente local cada um usa o seu —
> tokens gerados numa máquina simplesmente não valem na outra, o que é
> irrelevante para desenvolvimento.

### Adicionar a URL de runtime

O `.env.example` traz as URLs de migration. Você precisa acrescentar as de
runtime, que usam a role restrita:

```bash
DATABASE_URL_IDENTITY_APP=postgresql://quironequine_app:app_dev_password@localhost:5432/identity?schema=public
DATABASE_URL_INVENTORY_APP=postgresql://quironequine_app:app_dev_password@localhost:5433/inventory?schema=public
```

**Por que duas URLs por banco:** o usuário `quironequine` é superusuário do
PostgreSQL, e superusuários ignoram Row-Level Security. Se a aplicação
conectar com ele, o isolamento entre tenants não funciona — silenciosamente,
sem erro nenhum. Detalhes em `ADR-003` §1.

### Confirmar que o `.env` está protegido

```powershell
git check-ignore -v .env
```

Deve responder apontando a linha do `.gitignore`. Se não responder nada,
**pare** e avise o time antes de qualquer commit.

---

## 5. Subir o banco e aplicar as migrations

Existe um script que faz tudo na ordem correta:

```powershell
.\scripts\setup-db.ps1
```

Se o PowerShell bloquear a execução:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup-db.ps1
```

O `-Scope Process` vale só para essa janela — não altera a política da máquina.

### O que o script faz

1. Limpa migrations locais e volumes Docker
2. Sobe PostgreSQL, Redis e Adminer
3. Aguarda o healthcheck do banco
4. Cria as tabelas via `prisma migrate dev`
5. Cria e aplica a migration de Row-Level Security
6. Cria a role `quironequine_app` com as permissões corretas
7. Popula com dados de demonstração
8. Verifica migrations, policies e roles

**O script é destrutivo e idempotente:** apaga os volumes Docker e recomeça
do zero. Pode rodar quantas vezes precisar — enquanto não houver dados reais,
não há risco.

### Saída esperada

```
[7] Verificacao final

  Migrations aplicadas:
    20260727xxxxxx_init_identity_schema
    20260727xxxxxx_enable_rls

  Policies de RLS:
    8 policies (esperado: 8)

  Roles:
    quironequine        superuser=t  bypassrls=t
    quironequine_app    superuser=f  bypassrls=f
```

Os dois `f` na linha do `quironequine_app` são o ponto central. Se aparecesse
`t` em `bypassrls`, as 8 policies seriam decorativas.

---

## 6. Verificar que está tudo funcionando

### Containers

```powershell
docker compose ps
```

Quatro containers com status `Up`: `vq-db-identity`, `vq-db-inventory`,
`vq-redis`, `vq-adminer`. Os bancos dos marcos M2 a M4 só sobem quando
solicitados via `--profile`.

### Testes

```powershell
npm run test --workspace=@quironequine/ms-identity
```

Inclui o teste de isolamento RLS, que valida que um tenant não enxerga dados
de outro. Se ele falhar, o `.env` provavelmente está sem a variável
`DATABASE_URL_IDENTITY_APP`.

### Serviço

```powershell
npm run dev --workspace=@quironequine/ms-identity
```

Em outro terminal:

```powershell
curl http://localhost:3001/health
curl http://localhost:3001/health/ready
curl -i http://localhost:3001/owners
```

O último deve retornar **401 Unauthorized** — o comportamento correto, já que
o `AuthService` ainda não foi implementado e não há como obter token válido.

### Banco pela interface

Abra `http://localhost:8080` (Adminer):

- Sistema: PostgreSQL
- Servidor: `db-identity`
- Usuário: `quironequine`
- Senha: `quironequine`
- Base: `identity`

Você deve ver 9 tabelas com os dados de demonstração.

---

## 7. Checklist de conclusão

Marque cada item. O ambiente só está pronto quando todos passarem.

- [ ] `node --version` retorna 20 ou superior
- [ ] `docker run --rm hello-world` funciona
- [ ] Repositório clonado, na branch `develop`
- [ ] `npm install` concluído sem erro
- [ ] `npm audit` retorna zero vulnerabilidades
- [ ] `.env` criado, com `JWT_SECRET` próprio e as URLs `_APP`
- [ ] `git check-ignore -v .env` confirma que está ignorado
- [ ] `.\scripts\setup-db.ps1` concluiu com "Setup concluido"
- [ ] Verificação mostra 2 migrations, 8 policies, `bypassrls=f`
- [ ] `npm run test` passa, incluindo o teste de isolamento RLS
- [ ] `curl localhost:3001/health/ready` retorna `{"status":"ok"}`
- [ ] `curl localhost:3001/owners` retorna 401
- [ ] Adminer abre e mostra as 9 tabelas

---

## 8. Troubleshooting

Erros que já apareceram durante o setup do ambiente de referência.

### 8.1 `P1012: Environment variable not found: DATABASE_URL_IDENTITY`

O Prisma procura o `.env` no diretório de invocação, e o `--workspace` muda
o diretório para `apps/ms-identity`.

Os scripts `db:*` já trazem `dotenv -e ../../.env --` justamente para isso.
Se o erro aparecer, confirme que o script no `package.json` do workspace tem
o wrapper. Alternativa imediata: rodar da raiz com
`npx prisma migrate dev --schema apps/ms-identity/prisma/schema.prisma`.

### 8.2 `P3006: Migration failed to apply cleanly to the shadow database`

Alguma migration está fora de ordem ou com conteúdo errado. O Prisma cria um
banco temporário e replica todas as migrations do zero para detectar
divergências — se a de RLS rodar antes da que cria as tabelas, quebra.

Solução: rode o `setup-db.ps1`, que recria tudo na ordem correta.

### 8.3 `syntax error at or near "﻿"`

BOM — Byte Order Mark. O PowerShell 5.1 grava UTF-8 **com BOM** ao usar
`Set-Content -Encoding UTF8`, e o PostgreSQL rejeita esse byte.

Ao gerar arquivos `.sql` por script:

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $conteudo, $utf8NoBom)
```

O `.vscode/settings.json` do projeto previne o problema em arquivos criados
manualmente pelo editor.

### 8.4 `NativeCommandError` ao rodar Docker em script PowerShell

O Docker escreve mensagens de progresso no stderr. Com
`$ErrorActionPreference = 'Stop'`, o PowerShell trata qualquer linha de
stderr como exceção — mesmo sendo informativa.

Em scripts, use `$ErrorActionPreference = 'Continue'` e verifique
`$LASTEXITCODE` explicitamente após cada comando nativo.

### 8.5 `ReferenceError: exports is not defined`

Inconsistência entre `tsconfig` (CommonJS) e `package.json` (`"type": "module"`).

O projeto usa **CommonJS** no backend. Nenhum `package.json` deve ter
`"type": "module"`. Ver `ADR-003` §4.

### 8.6 Teste de isolamento RLS falhando

Quase sempre é a conexão de runtime usando o superusuário. Confirme:

```powershell
Select-String -Path .env -Pattern "DATABASE_URL_IDENTITY_APP"
```

E que o `src/prisma.ts` está lendo essa variável no `datasourceUrl`.

### 8.7 Porta 5432 já em uso

Você tem PostgreSQL instalado localmente. Edite o `docker-compose.yml`,
troque `'5432:5432'` por `'5442:5432'` e ajuste as URLs no `.env`.

### 8.8 `npm install` travando ou muito lento

Confirme que o `node_modules` está ignorado:

```powershell
git check-ignore -v node_modules
```

Sem isso o Git tentaria indexar milhares de arquivos.

---

## 9. Estrutura do projeto — quem é dono do quê

O Plano de Trabalho define a divisão. Resumo prático:

| Camada | Dono | Pasta |
|---|---|---|
| Schema Prisma, migrations, RLS | **Dev 1** | `apps/*/prisma/` |
| Services (lógica de negócio) | **Dev 1** | `apps/*/src/services/` |
| Repositories (acesso a dados) | **Dev 1** | `apps/*/src/repositories/` |
| Middlewares compartilhados | **Dev 1** | `packages/shared-middlewares/` |
| Docker, CI/CD dos microsserviços | **Dev 1** | `apps/ms-*/Dockerfile`, `.github/` |
| Controllers, validação Zod | **Dev 2** | `apps/*/src/controllers/`, `schemas/` |
| Adapters (Maps, WhatsApp, IA) | **Dev 2** | `apps/*/src/adapters/` |
| BFF Gateway | **Dev 2** | `apps/bff/` |
| PWA (telas, componentes) | **Dev 2** | `apps/pwa/` |
| Interfaces TypeScript | **Dev 1 publica** | `packages/shared-types/` |

### O contrato entre os dois

Dev 1 publica a **interface** em `packages/shared-types` antes de implementar
o Service. Dev 2 começa o Controller e a tela usando um `MockService` que
implementa a mesma interface.

Quando a implementação real chega, a troca é uma linha:

```typescript
// Enquanto espera:
const service = new MockOwnerService();  // implements IOwnerService

// Depois:
const service = new OwnerService(repo);  // mesma interface
```

Nenhuma tela muda. Zero retrabalho.

---

## 10. Fluxo de trabalho

### Branches

```
main       ← produção
staging    ← homologação
develop    ← integração (PR obrigatório)
  └── feature/MS1-002-auth-service
  └── fix/MS2-015-deduction-idempotency
  └── test/MS1-008-auth-service-unit
```

Toda tarefa nasce de `develop`:

```powershell
git checkout develop
git pull
git checkout -b feature/MS1-004-owner-screen
```

### Commits

```
feat(pwa): adiciona tela de listagem de proprietarios
fix(bff): corrige propagacao do trace_id no proxy
test(ms1): testes do OwnerController
refactor(pwa): extrai componente de busca com autocompletar
chore(ci): adiciona job de audit no workflow do PWA
docs(adr): registra decisao sobre message broker
```

### Definition of Done

Uma tarefa só está pronta quando:

1. Código revisado e aprovado pelo outro dev
2. CI verde: lint, testes, build, audit
3. Cobertura ≥ 70% nos serviços críticos
4. Testada localmente com `docker compose up`
5. Nenhum secret hardcoded
6. Branch mergeada em `develop` e feature branch deletada
7. Card movido para Done no board
8. README do MS atualizado se mudou interface ou setup

### Ritmo semanal

| Dia | Atividade |
|---|---|
| Segunda | Daily 15min. Dev 1 publica interfaces. Dev 2 inicia com mock. |
| Terça e quarta | Trabalho paralelo, sem bloqueio mútuo. |
| Quinta | Dev 1 abre PR. Dev 2 revisa e integra. |
| Sexta | Code review cruzado. Merge em `develop`. |
| Sexta tarde | Retrospectiva 30min. Board atualizado. |

**Bloqueado por mais de 2 horas?** Abra uma Issue e avise no WhatsApp.
Ninguém fica travado em silêncio.

---

## 11. Primeiras tarefas — Dev 2

O scaffolding do PWA existe mas está mínimo. Suas tarefas iniciais:

### Sprint 1 (restante)

- [ ] Design system base: `Button`, `Input`, `Select`, `Spinner`, `Toast`
- [ ] Tela de login consumindo `POST /api/v1/auth/login`
      (retorna 501 até o Dev 1 entregar o `AuthService` — use mock)
- [ ] Fluxo de refresh token no cliente React
- [ ] Testar instalação do PWA no Android e no iOS
- [ ] `Dockerfile` do PWA (multi-stage) e do BFF

### Sprint 2

- [ ] Controllers do MS1: `Auth`, `Veterinarian`, `Owner`, `Property`, `Animal`
- [ ] Validação Zod em todos os endpoints
- [ ] `MapsAdapter`: geocoding de endereço para lat/lng
- [ ] Telas: Dashboard, Proprietários, Propriedades, Animais
- [ ] Upload de foto de animal

### O que já existe e vale estudar

- `apps/ms-identity/src/controllers/owner.controller.ts` — Controller completo,
  serve de referência para os demais
- `apps/pwa/public/sw.js` — Service Worker escrito à mão, com as três
  estratégias de cache
- `apps/pwa/src/lib/api.ts` — cliente tipado do BFF
- `packages/shared-types/src/index.ts` — todas as interfaces de contrato

### O que não mexer sem alinhar

`prisma/schema.prisma`, `src/services/`, `src/repositories/` e
`packages/shared-middlewares/` são da Dev 1. Se precisar de mudança nessas
camadas, abra uma Issue em vez de editar direto — evita conflito e mantém a
divisão clara.

---

## 12. Documentação de referência

| Documento | Onde | Para quê |
|---|---|---|
| ERS v1.1 | `docs/` | Requisitos funcionais e não funcionais |
| Contrato | `docs/` | Marcos, prazos, obrigações |
| ADR-001 + adendo | `docs/adr/` | Decisão arquitetural e stack |
| ADR-003 | `docs/adr/` | Decisões da Sprint 1 (RLS, overrides, módulos) |
| Plano de Trabalho | `docs/` | Divisão de tarefas e sprints |
| C4 Level 2 e 3 | `docs/` (.drawio) | Arquitetura de containers e componentes |
| ERD | `docs/` (.drawio) | Modelo de dados dos 7 microsserviços |
| OpenAPI | `docs/` (.yaml) | Contrato da API — cole em editor.swagger.io |

---

## 13. Marcos contratuais

| Marco | Prazo | Escopo |
|---|---|---|
| M0 | Jun/2026 | Kick-off, scaffolding, ADR-001 |
| **M1** | **Jul/2026** | **MS1 Cadastros + MS2 Estoque + PWA base** |
| M2 | Set/2026 | MS3 Atendimento clínico, exames, vacinação |
| M3 | Dez/2026 | MS4 Agenda, MS5 Notificações, MS6 Relatórios |
| M4 | Jan/2027 | MS7 IA por voz (STT + LLM) |
| M5 | Fev/2027 | UAT, deploy em produção, entrega final |

Reunião quinzenal com os stakeholders, sempre com demo funcional — nunca
slides. Cláusulas 2.1 e 3ª do contrato.

---

*Dúvidas neste guia? Abra uma Issue com a label `documentation`.*
