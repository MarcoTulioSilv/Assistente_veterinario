# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Repository text (comments, commit conventions, docs) is in Portuguese (pt-BR); this file is in English but preserve pt-BR when writing code comments/docs consistent with the surrounding code.

## What this is

VetEquine is a multi-tenant SaaS for equine veterinary practice management, built as an npm workspaces monorepo (Turborepo) with 7 planned microservices, a BFF gateway, and a Next.js PWA. Only MS1 (`ms-identity`) is substantially implemented; MS2 (`ms-inventory`) has scaffolding only; MS3–MS7 do not exist yet. Treat unimplemented services as future work, not bugs.

Architecture is governed by **ADR-001** and requirements by **ERS v1.1** (referenced throughout the code as e.g. `ADR-001 §5.2`, `ERS §2.6`, `RN-006`, `RNF-MAN-003` — these are stable identifiers into docs not present in this checkout, but the section numbers in comments are meaningful and should be preserved/followed).

## Commands

Run from the repo root unless noted. Turborepo caches build/test/typecheck; `dev`/migrations are never cached.

```bash
npm install                                    # install all workspaces
npm run dev                                    # turbo run dev — all apps in watch mode
npm run build                                  # turbo run build (respects dependency graph)
npm run test                                   # vitest run, from repo root (all workspaces)
npm run test:cov                               # vitest run --coverage
npm run lint / npm run lint:fix                # eslint . (flat config, ESLint 9)
npm run typecheck                              # turbo run typecheck (tsc --noEmit per workspace)
npm run format                                 # prettier --write

npm run docker:up / docker:down / docker:reset # postgres-per-service + redis + adminer
npm run db:migrate -w @vetequine/ms-identity    # prisma migrate dev for one workspace
npm run db:generate -w @vetequine/ms-identity   # prisma generate
npm run db:seed -w @vetequine/ms-identity       # tsx prisma/seed.ts
npm run db:studio -w @vetequine/ms-identity     # Prisma Studio
```

Single test file / single test, inside a workspace (e.g. `apps/ms-identity`):

```bash
npx vitest run src/services/plan.service.test.ts
npx vitest run -t "bloqueia criação ao atingir 30 proprietários"
```

Row-Level Security policies are plain SQL, not a Prisma migration, and must be applied manually once per fresh DB, after the first `prisma migrate dev`:

```bash
docker exec -i vq-db-identity psql -U vetequine -d identity \
  < apps/ms-identity/prisma/migrations/00000000000000_enable_rls/migration.sql
```

Docker Compose profiles gate DBs for unbuilt services (`m2`, `m3`, `m4`) — `docker:up` only starts identity/inventory/redis/adminer by default.

## Architecture

### Request flow

`PWA → BFF Gateway (helmet, CORS, rate limit, proxy) → Controller (Zod validation) → Service (business rules) → Repository (Prisma via withTenant) → PostgreSQL (RLS)`

The BFF (`apps/bff`) does not implement business routes itself — it's an `http-proxy-middleware` reverse proxy that forwards `/api/v1/<resource>` prefixes to the owning microservice by env var URL (`MS_IDENTITY_URL`, `MS_INVENTORY_URL`, ...), stripping the `/api/v1` prefix, and forwards `x-trace-id`. Auth/rate-limiting live at the BFF; JWT verification happens per-microservice via shared `authMiddleware`.

### Multi-tenancy: Row-Level Security is the tenant boundary

This is the most important invariant in the codebase (ADR-001 §5.2):

- The JWT is the **only** source of `tenantId` — it is never accepted from the client/request body.
- `authMiddleware` (`packages/shared-middlewares/src/auth.ts`) verifies the JWT and attaches `req.ctx: RequestContext` (`tenantId`, `userId`, `role`, `plan`, `traceId`).
- **Every** Repository method must go through `withTenant(ctx.tenantId, fn)` (`apps/*/src/prisma.ts`), which opens a transaction, does `SELECT set_config('app.current_tenant', tenantId, true)`, then runs the query. Postgres RLS policies (one per table, see the `enable_rls` migration) filter rows by `tenant_id = current_tenant_id()` automatically — repositories never add `WHERE tenantId = ...` themselves.
- Repositories must never call `prisma` directly, only through `withTenant`.
- Each microservice owns its own Postgres database (database-per-service, ADR-001 §5.1) — there is no cross-service join; cross-service data flows through the message broker (Redis/BullMQ) as domain events (`packages/shared-types` `EVENTS`, `DomainEvent<T>`).

### Layering inside each microservice (`apps/ms-<name>/src/`)

```
controllers/   HTTP only: parse, Zod validate, status codes. Zero business logic.
services/      Business rules; the "owner" of ERS requirements (RN-xxx).
repositories/  Prisma access, always via withTenant(). Soft delete only (deletedAt), never hard DELETE (LGPD).
schemas/       Zod input validation, applied in controllers via the validate() middleware.
events/        Broker publishers/consumers (BullMQ-based).
prisma.ts      PrismaClient singleton + withTenant() + disconnectPrisma()
app.ts         Express app assembly (createApp())
index.ts       bootstrap, listen, graceful shutdown on SIGTERM/SIGINT
```

Services implement interfaces published in `packages/shared-types` (e.g. `IOwnerService`), so a not-yet-implemented service can be mocked against the same contract by whoever builds the consuming layer.

### Shared packages

- `packages/shared-types` — all cross-service TypeScript contracts: `RequestContext`, DTOs, domain models, `ErrorCode`/`ApiError`, `EVENTS`/`DomainEvent`. Money is always `Cents` (integer), never float (ADR-001 §5.6). Interfaces here are meant to be published *before* the implementation, so downstream work can proceed against the contract.
- `packages/shared-middlewares` — `authMiddleware`, `requireRole()`, `requirePlus()`, `traceMiddleware` (trace id propagation), `errorHandler`/`notFoundHandler`, `AppError` (standard error codes → HTTP status, e.g. `AppError.planLimit()`, `AppError.validation()`), Pino-based `logger`/`createServiceLogger()`.
- `packages/shared-config` — shared ESLint/Prettier/tsconfig base (root `eslint.config.mjs` and `tsconfig.base.json` are the actual sources of truth currently).

### Errors

All errors thrown as `AppError` (`code`, `message`, `statusCode`, optional field-level `details`) are caught by the shared `errorHandler` and serialized as `ApiError` with a `traceId`. Non-`AppError` exceptions are logged with full detail server-side but returned to the client as a generic `INTERNAL_ERROR` — never leak stack traces or internal messages.

### Background jobs

BullMQ (not `node-cron`, which pulled in a vulnerable `uuid` transitively) backs both event consumption and scheduled jobs. See `apps/ms-inventory/src/services/alert-scheduler.ts` for the pattern: `Queue.upsertJobScheduler()` for idempotent recurring jobs (cron pattern + timezone), plus a `Worker` with `completed`/`failed` handlers.

## Conventions

- **TypeScript strict**, no implicit `any` (ESLint hard-errors on `@typescript-eslint/no-explicit-any`). `noUncheckedIndexedAccess` is on — index access returns `T | undefined`.
- **No `console.log`** in service code (ESLint error) — use the Pino `logger`/`createServiceLogger()`. Console is allowed in `prisma/seed.ts` and `scripts/**`.
- **Money in cents**, integer, never float.
- **Soft delete** (`deletedAt` timestamp) on every table with personal data; never a physical `DELETE` — required for LGPD compliance.
- **Test coverage floor of 70%** (branches/functions/lines/statements) enforced by Vitest coverage thresholds, scoped to `src/services/**` and `src/repositories/**` per workspace `vitest.config.ts`.
- Tests are colocated as `*.test.ts` next to the source file, using Vitest's global `describe`/`it`/`expect` (`globals: true`).
- Vitest replaced Jest project-wide (Jest's toolchain pulled a vulnerable `minimatch`/`brace-expansion` via `glob`); ESLint 9 flat config replaced `.eslintrc` for the same reason (old `@eslint/eslintrc` chain). Don't reintroduce either.
- Commit convention: `type(scope): description`, e.g. `feat(ms1): add AuthService login com 2FA`, `fix(ms2): corrige dupla baixa em redelivery do broker`. Scopes are service names (`ms1`, `ms2`, `bff`, `adr`, `ci`, ...). Branches: `feature/MS1-001-descricao`, `fix/MS2-015-descricao`, `test/MS1-008-descricao`.
- CI (`.github/workflows/*.yml`) per-service, path-filtered: lint+typecheck → test (against a real ephemeral Postgres via `prisma migrate deploy`) → `npm audit --omit=dev --audit-level=high` (blocking) + full audit (informative) → Docker build. New services need their own workflow file following the `ms-identity.yml` pattern.

-Mantenha toda interação com o usuário em PT-BR
