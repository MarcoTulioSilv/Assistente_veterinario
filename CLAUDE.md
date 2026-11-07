# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repository text (comments, commit conventions, docs) is in Portuguese (pt-BR); this file is in English but preserve pt-BR when writing code comments/docs consistent with the surrounding code.

## What this is

Quíron Equine is a multi-tenant SaaS for equine veterinary practice management, built as an npm workspaces monorepo (Turborepo) with 7 planned microservices, a BFF gateway, and a Next.js PWA. The product's real name is **QuironEqui** (domain `quironequi.com.br`); package, folder, image and database names keep `quironequine` — don't rename them. User-facing text is the PWA's (Dev 2) concern.

Current state (Nov/2026): milestone M2 is **live on staging** for the stakeholders' homologation — PWA at `https://homolog.quironequi.com.br`, API at `https://api-homolog.quironequi.com.br`.

| Workspace | Service | State |
|---|---|---|
| `apps/ms-identity` | MS1 — auth (per-device sessions), tenants/vet profile, owners, properties, animals, uploads, geocoding and route distance (public Nominatim/OSRM servers: fine for homologation, not for production) | implemented |
| `apps/ms-inventory` | MS2 — products, stock movements, expiry/low-stock alerts, stock deduction from domain events (quantities in ml for medication/vaccine) | implemented |
| `apps/ms-clinical` | MS3 — appointments/quotes (several animals each), exams, vaccinations, outbox, daily reminders | implemented |
| `apps/ms-reporting` | MS6 — only the financial-pending slice (anticipated from M3) | partial |
| `apps/bff` | gateway: helmet, CORS, rate limits, reverse proxy | implemented |
| `apps/pwa` | Next.js 16 PWA (automatic session refresh, real logout) | in progress (Dev 2) |
| MS4 scheduling, MS5 notification, MS7 AI voice | — | not started (M3/M4); events for MS5 are already published and wait in its queue |

Treat services that don't exist yet as future work, not bugs. Architecture is governed by **ADR-001** (plus ADR-002 to ADR-006 in `Documentação/ADR/`) and requirements by the **ERS** (referenced throughout the code as e.g. `ADR-001 §5.2`, `ERS §2.6`, `RN-006`, `RNF-MAN-003` — stable identifiers; keep and follow them).

**Ownership split** (stated at the top of most files): Dev 1 (Marco) owns schema, migrations, repositories, services and contracts in `shared-types`; Dev 2 (João) owns controllers, Zod input schemas in `schemas/` of MS1/MS2, the BFF routes and the PWA. Contracts are published in `shared-types` before the implementation, so the other side can work against a mock. Requests between the two live in `Documentação/pedidos-para-marco.md` and `Documentação/pedidos-para-joao.md`.

## Commands

Run from the repo root unless noted. Turborepo caches build/test/typecheck; `dev`/migrations are never cached.

```bash
npm ci                                         # install (see "npm and the lockfile" below)
npm run db:generate                            # prisma generate, all services — REQUIRED after npm ci on Node 24/npm 11 (install scripts don't run)
npm run dev                                    # turbo run dev — all apps in watch mode
npm run build / npm run typecheck              # turbo
npm run test                                   # vitest run, all workspaces (integration tests need the DBs up)
npm run lint / npm run lint:fix                # eslint (flat config, ESLint 9)
npm run audit:ci                               # what CI blocks on (.audit-ci.json allowlist, with justification)

npm run docker:up / docker:down / docker:reset # postgres-per-service + redis + adminer
docker compose --profile m2 --profile m3 up -d # also clinical (m2) and reporting (m3) DBs
npm run db:migrate -w @quironequine/ms-identity    # prisma migrate dev for one workspace
npm run seed:homologacao                       # realistic demo data across the 4 DBs (wipes and recreates only the homologation tenants)
```

Single test file / single test, inside a workspace:

```bash
npx vitest run src/services/plan.service.test.ts
npx vitest run -t "bloqueia criação ao atingir 30 proprietários"
```

**Database roles.** RLS policies, `SECURITY DEFINER` functions and CHECK constraints live in the Prisma migrations (hand-written SQL where Prisma can't express it). The runtime role `quironequine_app` and its grants come from `infra/postgres-init/01-create-app-role.sql`, which must be re-run **after** migrations whenever a migration adds a function the app calls (CI and the staging deploy do this):

```bash
docker exec -i vq-db-identity psql -U quironequine -d identity < infra/postgres-init/01-create-app-role.sql
```

`ms-inventory` has a GENERATED column (`sale_price_cents`): its migrations are written by hand; never run `migrate dev` there without `--create-only`.

**Windows gotchas.** Stop `npm run dev` before `npm ci`/`prisma generate` (the Prisma query engine DLL is locked → EPERM; the JS client still generates). If the PWA dev server breaks after an install, delete `apps/pwa/.next`.

## Architecture

### Request flow

`PWA → Caddy (staging/prod) → BFF (helmet, CORS, rate limit, proxy) → Controller (Zod validation) → Service (business rules) → Repository (Prisma via withTenant) → PostgreSQL (RLS)`

The BFF (`apps/bff`) has no business routes — it's an `http-proxy-middleware` reverse proxy that forwards `/api/v1/<resource>` prefixes to the owning microservice by env var URL, stripping `/api/v1`, and forwards `x-trace-id`. Rate limits live in `apps/bff/src/rate-limit.ts`; behind the Caddy, `TRUST_PROXY=1` is what makes them per client (without it every request has the proxy's IP). JWT verification happens per microservice via the shared `authMiddleware`.

### Multi-tenancy: Row-Level Security is the tenant boundary

This is the most important invariant in the codebase (ADR-001 §5.2):

- The JWT is the **only** source of `tenantId` — never accepted from the client/request body.
- `authMiddleware` (`packages/shared-middlewares/src/auth.ts`) verifies the JWT and attaches `req.ctx: RequestContext` (`tenantId`, `userId`, `role`, `plan`, `traceId`).
- **Every** repository method goes through `withTenant(ctx.tenantId, fn)` (`apps/*/src/prisma.ts`), which opens a transaction and sets `app.current_tenant`; RLS policies filter by `tenant_id = current_tenant_id()`. Repositories never add `WHERE tenantId = ...` themselves.
- **When something must cross tenants** (login lookup by e-mail, refresh by session id, daily jobs scanning every tenant, the outbox relay): a narrow `SECURITY DEFINER` SQL function that returns only what is needed (ADR-004, ADR-006). **Never** a second Prisma client that bypasses RLS. `ms-clinical/tests/rls-guard.test.ts` fails if a table — including a future one — is left without RLS.
- Foreign keys are checked by Postgres without RLS: a plain FK accepts an id from **another tenant**. When a write references a client-supplied id of the same service, use a composite `(tenant_id, x_id) → (tenant_id, id)` FK (MS1: `fk_composta_tenant` migration; `onDelete: NoAction` instead of `SetNull`, which would null `tenant_id`) **and** check the id inside the same `withTenant` so the client gets 404, not a 500 from the FK (`ms-identity/src/repositories/tenant-references.ts`). MS2/MS3 validate their references in the service (`findById` under RLS) but don't have composite FKs yet.
- Each microservice owns its own database (database-per-service, ADR-001 §5.1); no cross-service joins. IDs from other services are stored without FK.

### Events (ADR-002)

Redis + BullMQ, one queue per consumer (fan-out in the publisher). Events and subscribers are declared in `packages/shared-types` (`EVENTS`, `EVENT_SUBSCRIBERS`, payload types). MS3 publishes through an **outbox** written in the same transaction as the state change; idempotency keys are derived from the source (`deriveEventIdempotencyKey`), and consumers dedupe on a UNIQUE key. Read-only scans (reminders, stock alerts) publish directly. Scheduled jobs use `Queue.upsertJobScheduler()` with the São Paulo timezone (see `alert-scheduler.ts`, `reminder-scheduler.ts`) — not `node-cron`.

### Auth sessions (ADR-004 rev. 1.1)

Access token: HS256 JWT, 15 min. Refresh token: opaque `<sessionId>.<secret>`, one row per device in `user_sessions` (SHA-256 of the secret only). It travels **only** in the `qe_refresh` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, set by `ms-identity/src/lib/refresh-cookie.ts`): login/refresh respond `AuthSession` (no refresh token in the body), refresh/logout take no body, and a failed refresh clears the cookie. The PWA must call the auth routes with `credentials: 'include'`. Refresh rotates with a conditional UPDATE; a just-rotated token is accepted for 30 s (two tabs, retries), after that reuse revokes the whole family. Logout revokes only that device's session and always returns 204.

### Layering inside each microservice (`apps/ms-<name>/src/`)

```
controllers/   HTTP only: parse, Zod validate, status codes. Zero business logic.
services/      Business rules; the "owner" of ERS requirements (RN-xxx).
repositories/  Prisma access, always via withTenant(). Soft delete only (deletedAt), never hard DELETE (LGPD).
schemas/       Zod input validation, applied in controllers via the validate() middleware.
events/        Broker publishers/consumers and schedulers (BullMQ).
prisma.ts      PrismaClient singleton + withTenant() + disconnectPrisma()
app.ts         Express app assembly (createApp())
index.ts       bootstrap, listen, graceful shutdown on SIGTERM/SIGINT
```

Services implement interfaces published in `packages/shared-types` (e.g. `IOwnerService`), so a not-yet-implemented service can be mocked against the same contract.

### Shared packages

- `packages/shared-types` — all cross-service contracts: `RequestContext`, DTOs, domain models, `ErrorCode`/`ApiError`, `EVENTS`/`DomainEvent`. Money is always `Cents` (integer), never float (ADR-001 §5.6).
- `packages/shared-middlewares` — `authMiddleware`, `requireRole()`, `requirePlus()`, `traceMiddleware`, `errorHandler`/`notFoundHandler`, `AppError`, Pino `logger`/`createServiceLogger()` (with redaction of secrets).

### Errors

All errors thrown as `AppError` (`code`, `message`, `statusCode`, optional field-level `details`) are serialized as `ApiError` with a `traceId`. Non-`AppError` exceptions return a generic `INTERNAL_ERROR` — never leak stack traces or internal messages.

### Staging

`infra/staging/`: one VM (Oracle Cloud, ARM A1) with Docker Compose — Caddy (automatic HTTPS), PWA, BFF, the four services, one Postgres with one DB per service, Redis. `.github/workflows/deploy-staging.yml` builds the images (native ARM runner when `STAGING_PLATFORM=linux/arm64`), pushes to GHCR and runs `infra/staging/deploy.sh` over SSH with a pinned host key. Runtime secrets live only on the server (`.env.staging`, generated by `generate-env.sh`). Full runbook: `Documentação/Manual-de-implantacao-staging.md`.

- **Seed on staging**: *Actions → Seed staging*, run on branch **`staging`** (the `staging` environment only releases its secrets to that branch), typing `homologacao` to confirm. It wipes and recreates only the homologation tenants.
- The seed password exists only on the server (`.env.staging`) and in the GitHub secret — never write it in the repo or in a conversation.
- Lessons from the first deploy:
  - a new `.sh` needs `git update-index --chmod=+x` (Windows doesn't record the executable bit);
  - secrets pasted from Windows may carry CRLF (the workflows already strip it);
  - every route the service worker pre-caches (`SHELL_ASSETS` in `apps/pwa/public/sw.js`) must exist, or the SW install fails.

## Conventions

- **TypeScript strict**, no `any` (ESLint error). `noUncheckedIndexedAccess` is on.
- **No `console.log`** in service code — use `createServiceLogger()`. Console is allowed in seeds and `scripts/**`. Don't log personal data (names, CPF, addresses) or raw Prisma error messages.
- **Money in cents**, integer. **Medication and vaccine quantities in ml** (stakeholder decision, Nov/2026): `Product.mlPerUnit` converts ml to stock units in `StockService.deduct`.
- **Soft delete** (`deletedAt`) on every table with personal data; never a physical `DELETE` (LGPD). The runtime role has **no `DELETE`** (`01-create-app-role.sql`): only the MS3 link/item tables rewritten while a quote is a draft are granted it (section 3c) — a new table that really needs it goes in that list. Integration tests clean up through the migration connection (`DATABASE_URL_*`, see `tests/admin-db.ts` in MS3/MS6), never through the app role.
- **Audit trail** (`audit_log` in MS1, MS3, MS6; LGPD art. 37): every write to personal, clinical or financial data calls `writeAudit(tx, actor, entry)` (`shared-middlewares`) inside the same `withTenant`, recording who, action, table, record id and the **names** of the fields — never the values (the table is insert-only, so values there could never be erased). Detail screens of medical records/exam reports log reads via `findById(ctx, id, { audit: true })`; internal existence checks don't. Event consumers write `user_id` null plus `source`.
- **Migrations that change the meaning of existing data**: before go-live it was acceptable to rename/drop (homologation data is reseeded); after go-live, only new column + explicit data migration.
- **Coverage floor 70%** on `src/services/**` and `src/repositories/**`. Tests colocated as `*.test.ts`; integration tests in `tests/` run against the real Postgres as `quironequine_app`. Vitest (not Jest), ESLint 9 flat config — don't reintroduce Jest or `.eslintrc`.
- **Commits**: `type(scope): descrição` in pt-BR, scopes are service names (`ms1`, `ms2`, `ms3`, `ms6`, `bff`, `pwa`, `infra`, `ci`, `docs`). Branches: `feature/MS3-012-descricao`, `fix/...`.
- **Git flow**: `develop` is the default branch; feature/fix branches → PR to `develop` → PR `develop → staging` (triggers the deploy). `main` only for closed releases. Every PR gets a review before merge. Don't push or open PRs unless asked.
- **npm and the lockfile**: re-resolving a transitive dependency can silently drop packages from `package-lock.json`. Fix advisories with root `overrides` and check the lock diff (no removed packages) before committing; then `npm ci`.
- **CI** (`.github/workflows/*.yml`), per service and path-filtered: lint+typecheck → tests against an ephemeral Postgres (`prisma migrate deploy` + role script) → `audit-ci` (blocking) → Docker build + smoke test. Gitleaks scans the history on every PR.

- Mantenha toda interação com o usuário em PT-BR.

## Pending: security audit (06/11/2026)

The report lives outside the repo (ask Marco for it). Done: A-02 (per-client rate limit in the BFF), A-03 (per-device sessions, atomic rotation, real logout — server and PWA), M-04 for the refresh token. Pending, in the audit's suggested order:

1. Refresh token in an `HttpOnly` cookie: server side done on `develop`; the PWA side and A-01 (service worker caches personal data keyed only by URL and keeps it after logout) are with João (`pedidos-para-joao.md`). **Don't open `develop → staging` until the PWA side lands** — until then the PWA on `develop` can't refresh.
2. ~~M-01~~ and ~~M-06~~: done (composite FKs in MS1; no `DELETE` for the app role; `audit_log` written in MS1/MS3/MS6).
3. M-02 (per-account login/TOTP lockout, TOTP replay), M-03 (signed URLs for uploaded exam reports), M-05 (personal data and raw Prisma messages in logs).
4. Rest of M-04: password hashing off `bcryptjs` (native modules are a problem on the ARM image; Node's built-in `scrypt` with rehash on login is an option).
5. B-01 to B-08, I-01, I-02.

Product gaps found alongside: clinic sign-up screen (the API exists), password change, real password reset (today it's a mock).

