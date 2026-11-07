# Quíron Equine — Sistema de Gestão Veterinária Equina (SaaS)

Monorepo com 7 microsserviços, BFF Gateway e PWA.
Base: **ERS v1.1** · **ADR-001** · **SWEBOK v4.0** · **DevSecOps**

---

## Início rápido

```bash
# 1. Clonar e instalar
git clone <repo-url> quironequine && cd quironequine
npm install

# 2. Configurar ambiente
cp .env.example .env
# Gere um JWT_SECRET forte:
openssl rand -base64 48
# Cole o resultado em JWT_SECRET no arquivo .env

# 3. Subir a infraestrutura (PostgreSQL + Redis)
npm run docker:up

# 4. Rodar migrations do MS1
npm run db:migrate --workspace=@quironequine/ms-identity

# 5. Aplicar Row-Level Security (uma vez só)
docker exec -i vq-db-identity psql -U quironequine -d identity \
  < apps/ms-identity/prisma/migrations/00000000000000_enable_rls/migration.sql

# 6. Popular com dados de demonstração
npm run db:seed --workspace=@quironequine/ms-identity

# 7. Rodar em modo desenvolvimento
npm run dev
```

> **Já tinha o projeto rodando antes do rebranding (VetEquine → Quíron Equine)?**
> O usuário/senha do Postgres e a role de aplicação mudaram de `vetequine`/`vetequine_app`
> para `quironequine`/`quironequine_app` (ver `docker-compose.yml` e
> `infra/postgres-init/01-create-app-role.sql`). Seu `.env` local **não** é atualizado
> automaticamente ao puxar essa mudança — sem isso, os serviços falham ao conectar no
> banco, silenciosamente. Depois de atualizar:
> 1. Copie os novos valores de `DATABASE_URL_*`, `REDIS_QUEUE_PREFIX` e `S3_BUCKET` do
>    `.env.example` pro seu `.env` (mantenha seu `JWT_SECRET` e demais segredos)
> 2. `npm run docker:reset` (recria os volumes do zero com a nova role)
> 3. Rode de novo os passos 4–6 acima (migrations, RLS, seed)

**Acessos após o setup:**

| Serviço | URL | Credencial |
|---|---|---|
| PWA | http://localhost:3100 | demo@quironequine.com.br / quironequine123 |
| BFF Gateway | http://localhost:3000 | — |
| MS1 Identity | http://localhost:3001 | — |
| MS2 Inventory | http://localhost:3002 | — |
| Adminer (DB UI) | http://localhost:8080 | quironequine / quironequine |

---

## Estrutura do monorepo

```
quironequine/
├── apps/
│   ├── pwa/              Next.js 14 PWA — Dev 2
│   ├── bff/              BFF Gateway (Express) — Dev 2
│   ├── ms-identity/      MS1 Cadastros + Auth — Dev 1 (M1)
│   ├── ms-inventory/     MS2 Estoque — Dev 1 (M1)
│   ├── ms-clinical/      MS3 Atendimento — (M2)
│   ├── ms-scheduling/    MS4 Agenda — (M3)
│   ├── ms-notification/  MS5 Notificações — (M3)
│   ├── ms-reporting/     MS6 Financeiro — (M3)
│   └── ms-aivoice/       MS7 IA por Voz — (M4)
├── packages/
│   ├── shared-types/         Interfaces TypeScript (contrato Dev1 → Dev2)
│   ├── shared-middlewares/   Auth, logger, trace, error handler
│   └── shared-config/        ESLint, Prettier, tsconfig
├── infra/                Docker, Terraform, scripts
└── .github/workflows/    CI/CD por microsserviço
```

---

## Padrão interno de cada microsserviço

```
apps/ms-<nome>/
├── prisma/
│   ├── schema.prisma      ← Dev 1: tabelas, enums, índices
│   ├── migrations/        ← versionadas no Git
│   └── seed.ts            ← dados de demonstração
├── src/
│   ├── index.ts           ← bootstrap + graceful shutdown
│   ├── app.ts             ← montagem do Express
│   ├── prisma.ts          ← client + withTenant() para RLS
│   ├── controllers/       ← Dev 2: HTTP, parse, status code
│   ├── services/          ← Dev 1: lógica de negócio da ERS
│   ├── repositories/      ← Dev 1: Prisma, sempre via withTenant()
│   ├── schemas/           ← Dev 2: validação Zod
│   └── events/            ← publishers/consumers do broker
├── Dockerfile             ← multi-stage, usuário não-root
└── jest.config.js         ← cobertura mínima 70%
```

**Fluxo de uma requisição:**
`PWA → BFF (auth, rate limit) → Controller (Zod) → Service (regras) → Repository (RLS) → PostgreSQL`

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe todos os apps em watch mode |
| `npm run build` | Compila tudo (Turborepo com cache) |
| `npm run test` | Roda testes de todos os workspaces |
| `npm run test:cov` | Testes com relatório de cobertura |
| `npm run lint` | ESLint em todos os workspaces |
| `npm run typecheck` | Verifica tipos sem gerar build |
| `npm run docker:up` | Sobe PostgreSQL + Redis + Adminer |
| `npm run docker:down` | Para os containers |
| `npm run docker:reset` | Apaga volumes e recria do zero |
| `npm run db:migrate -w @quironequine/ms-identity` | Migration do MS1 |
| `npm run db:studio -w @quironequine/ms-identity` | Prisma Studio (UI do banco) |
| `npm run db:seed -w @quironequine/ms-identity` | Popula dados de demo |

---

## Regras inegociáveis

- **Zero secrets no código.** Sempre `.env.local` + GitHub Secrets. PR com secret é rejeitado.
- **PR obrigatório.** Todo merge em `develop` precisa de review do outro dev.
- **Cobertura ≥ 70%** nos services e repositories (RNF-MAN-003).
- **Valores monetários em centavos** (`INTEGER`). Nunca `FLOAT` (ADR-001 §5.6).
- **Soft delete** em toda tabela com dados pessoais — LGPD, Cláusula 10ª do contrato.
- **TypeScript strict.** Proibido `any` implícito.
- **`withTenant()` sempre.** Nenhum Repository acessa o Prisma diretamente.

---

## Convenção de commits

```
feat(ms1): add AuthService login com 2FA
fix(ms2): corrige dupla baixa em redelivery do broker
test(ms1): unit tests do PlanService
refactor(bff): extrai middleware de rate limit
chore(ci): adiciona npm audit no pipeline
docs(adr): atualiza ADR-002 sobre message broker
```

**Branches:** `feature/MS1-001-descricao` · `fix/MS2-015-descricao` · `test/MS1-008-descricao`

---

## Marcos contratuais

| Marco | Prazo | Escopo |
|---|---|---|
| M0 | Jun/2026 | Kick-off · Scaffolding · ADR-001 |
| **M1** | **Jul/2026** | **MS1 Cadastros + MS2 Estoque + PWA base** |
| M2 | Set/2026 | MS3 Atendimento clínico + Exames + Vacinação |
| M3 | Dez/2026 | MS4 Agenda + MS5 Notificações + MS6 Relatórios |
| M4 | Jan/2027 | MS7 IA por Voz (STT + LLM) |
| M5 | Fev/2027 | UAT · Deploy produção · Entrega final |

---

## Documentação do projeto

- `docs/ERS_QuironEquine_v1.1.docx` — Especificação de Requisitos
- `docs/ADR-001_Arquitetura.docx` — Decisão arquitetural
- `docs/PlanoTrabalho_KA_Construcao.docx` — Divisão de tarefas e sprints
- `docs/QuironEquine_C4_Level2_Container.drawio` — Arquitetura de containers
- `docs/QuironEquine_ERD_Completo.drawio` — Modelo de dados
- `docs/QuironEquine_OpenAPI_BFF_v1.0.yaml` — Contrato da API
