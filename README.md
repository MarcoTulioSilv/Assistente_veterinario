<p align="center">
  <img src="https://readme-typing-svg.demolab.com/?lines=Gest%C3%A3o+Veterin%C3%A1ria+Equina;7+Microsservi%C3%A7os+%2B+BFF+Gateway;IA+por+Voz%3A+Whisper+%2B+LLM&font=Fira%20Code&center=true&width=520&height=45&color=0d9488&vCenter=true&pause=1200&size=20" alt="VetEquine" />
</p>

<h1 align="center">🐴 VetEquine — Sistema de Gestão Veterinária Equina (SaaS)</h1>
<p align="center">Monorepo com 7 microsserviços, BFF Gateway e PWA</p>
<p align="center">Base: <b>ERS v1.1</b> · <b>ADR-001</b> · <b>SWEBOK v4.0</b> · <b>DevSecOps</b></p>

<p align="center">
  <img alt="TypeScript" height="36" title="TypeScript" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/typescript/typescript-original.svg" />
  <img alt="Next.js" height="36" title="Next.js (PWA)" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/nextjs/nextjs-original.svg" />
  <img alt="Express" height="36" title="Express (BFF + microsserviços)" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/express/express-original.svg" />
  <img alt="PostgreSQL" height="36" title="PostgreSQL" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/postgresql/postgresql-original.svg" />
  <img alt="Prisma" height="36" title="Prisma" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/prisma/prisma-original.svg" />
  <img alt="Redis" height="36" title="Redis" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/redis/redis-original.svg" />
  <img alt="Docker" height="36" title="Docker" src="https://raw.githubusercontent.com/devicons/devicon/master/icons/docker/docker-original.svg" />
</p>

## Proposta do Projeto

SaaS de gestão veterinária para clínicas e profissionais especializados em equinos: centraliza prontuários, estoque, agenda e atendimento clínico numa PWA única, com um diferencial de IA — o **MS7 (IA por Voz)** transcreve a consulta automaticamente (Whisper STT) e um LLM gera o resumo clínico estruturado, reduzindo o tempo que o veterinário gasta documentando em vez de atendendo.

A arquitetura é deliberadamente distribuída (7 microsserviços + BFF Gateway) para que cada domínio evolue e escale de forma independente — ver a decisão registrada em `docs/ADR-001_Arquitetura.docx` e o detalhamento técnico público em [vetequine-architecture-showcase](https://github.com/joaolmpv/vetequine-architecture-showcase).

## 📸 Telas do sistema

> Ainda não há screenshots aqui — para gerar, suba a stack local (`npm run docker:up` + migrations, ver [Início rápido](#início-rápido)) e adicione as imagens em `docs/screenshots/`. Vale para PWA, Adminer e qualquer dashboard interno que valha mostrar no README.

## 📅 Diário de Desenvolvimento

> Uma linha por dia/sessão de trabalho. Serve tanto para acompanhar o progresso quanto para o próximo dev entender rápido "onde paramos".

| Data | O que mudou |
|---|---|
| 2026-09-14 | README reorganizado: proposta do projeto, stack e espaço para screenshots/diário adicionados no topo — conteúdo técnico original (comandos, regras, marcos) preservado abaixo. |

---

## Início rápido

```bash
# 1. Clonar e instalar
git clone <repo-url> vetequine && cd vetequine
npm install

# 2. Configurar ambiente
cp .env.example .env
# Gere um JWT_SECRET forte:
openssl rand -base64 48
# Cole o resultado em JWT_SECRET no arquivo .env

# 3. Subir a infraestrutura (PostgreSQL + Redis)
npm run docker:up

# 4. Rodar migrations do MS1
npm run db:migrate --workspace=@vetequine/ms-identity

# 5. Aplicar Row-Level Security (uma vez só)
docker exec -i vq-db-identity psql -U vetequine -d identity \
  < apps/ms-identity/prisma/migrations/00000000000000_enable_rls/migration.sql

# 6. Popular com dados de demonstração
npm run db:seed --workspace=@vetequine/ms-identity

# 7. Rodar em modo desenvolvimento
npm run dev
```

**Acessos após o setup:**

| Serviço | URL | Credencial |
|---|---|---|
| PWA | http://localhost:3100 | demo@vetequine.com.br / vetequine123 |
| BFF Gateway | http://localhost:3000 | — |
| MS1 Identity | http://localhost:3001 | — |
| MS2 Inventory | http://localhost:3002 | — |
| Adminer (DB UI) | http://localhost:8080 | vetequine / vetequine |

---

## Estrutura do monorepo

```
vetequine/
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
| `npm run db:migrate -w @vetequine/ms-identity` | Migration do MS1 |
| `npm run db:studio -w @vetequine/ms-identity` | Prisma Studio (UI do banco) |
| `npm run db:seed -w @vetequine/ms-identity` | Popula dados de demo |

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

- `docs/ERS_VetEquine_v1.1.docx` — Especificação de Requisitos
- `docs/ADR-001_Arquitetura.docx` — Decisão arquitetural
- `docs/PlanoTrabalho_KA_Construcao.docx` — Divisão de tarefas e sprints
- `docs/VetEquine_C4_Level2_Container.drawio` — Arquitetura de containers
- `docs/VetEquine_ERD_Completo.drawio` — Modelo de dados
- `docs/VetEquine_OpenAPI_BFF_v1.0.yaml` — Contrato da API
