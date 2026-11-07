# ADR-001 — Adendo: atualização da stack (Julho 2026)

| | |
|---|---|
| **Documento base** | ADR-001 — Arquitetura de Microsserviços com BFF Gateway (Jun/2026) |
| **Tipo** | Adendo — não substitui o documento original |
| **Data** | Julho 2026 |
| **Status** | **ACEITO** |
| **Motivo** | Correção de 54 vulnerabilidades identificadas no setup do M1 |
| **Detalhamento** | ADR-003 — Decisões de Implementação da Sprint 1 |

---

## O que mudou

A tabela de stack do ADR-001 §4 foi definida em junho, antes da primeira
instalação de dependências. A auditoria de segurança executada no setup do
ambiente exigiu as substituições abaixo.

**A decisão arquitetural central permanece intacta:** microsserviços por domínio
DDD, BFF Gateway, PWA, database-per-service, comunicação assíncrona via broker.
Nada disso muda.

---

## Tabela de stack revisada

| Camada | ADR-001 (Jun/2026) | Atual (Jul/2026) | Motivo da mudança |
|---|---|---|---|
| Frontend (PWA) | Next.js 14 + React 18 | **Next.js 16 + React 19** | 21 CVEs de produção no Next 14 (SSRF, XSS, cache poisoning, DoS) |
| PWA / offline | `next-pwa` (Workbox) | **Service Worker próprio** | Plugin arquivado; Workbox arrastava RCE via `serialize-javascript` |
| Testes | Jest + ts-jest | **Vitest** | `jest → glob → minimatch → brace-expansion` (CVE de DoS) |
| Lint | ESLint 8 + `.eslintrc.json` | **ESLint 9 + flat config** | ESLint 8 em fim de vida; config antiga puxava `@humanwhocodes/config-array` |
| Agendamento | `node-cron` | **BullMQ Job Scheduler** | `node-cron → uuid < 11.1.1` (CVE); BullMQ já estava no projeto |
| ORM | Prisma 5 | **Prisma 6** | Versão corrente |
| Runtime (CI) | Node 20 LTS | **Node 22 LTS** | Alinhamento com o suporte atual |
| Sistema de módulos | não especificado | **CommonJS** | Consistência entre `tsconfig` e `package.json` (ADR-003 §4) |

### Inalterado

Node.js + Express + TypeScript nos microsserviços e no BFF · PostgreSQL 16 ·
Docker + Docker Compose · GitHub Actions · Redis · JWT próprio com bcrypt ·
OpenAI Whisper (STT) · GPT-4o-mini / Gemini Flash (LLM) · S3 / Cloudflare R2 ·
Sentry + Grafana.

---

## Complemento ao §5.2 — Row-Level Security

O ADR-001 §5.2 descreve o mecanismo de RLS mas omite um detalhe crítico:
**superusuários do PostgreSQL ignoram RLS**. A configuração descrita no
documento original não protegeria nada em runtime.

A correção — conexões separadas para migration e runtime — está detalhada na
Decisão 1 do ADR-003.

Trecho a ser lido em conjunto com o §5.2 original:

```sql
-- Runtime NUNCA conecta como superusuário.
-- quironequine_app tem rolsuper = false e rolbypassrls = false.
CREATE ROLE quironequine_app WITH LOGIN PASSWORD '...';
```

---

## Complemento ao §9 — Pipeline CI/CD

O pipeline descrito no §9 ganha um desdobramento no job `sast`:

| Job | Comando | Comportamento |
|---|---|---|
| `audit:prod` | `npm audit --omit=dev --audit-level=high` | **Bloqueia** o merge |
| `audit:full` | `npm audit --audit-level=high` | Informativo (`continue-on-error`) |

Justificativa e escopo da flexibilização: ADR-003 §3.

O job de testes passa a exigir a criação da role de aplicação antes de rodar,
para que os testes de isolamento RLS funcionem no ambiente de CI.

---

## Histórico

| Versão | Data | Descrição |
|---|---|---|
| 1.0 | Jul/2026 | Criação do adendo após auditoria de segurança da Sprint 1 |
