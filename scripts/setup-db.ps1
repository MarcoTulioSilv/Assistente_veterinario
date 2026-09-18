# ══════════════════════════════════════════════════════════════════
#  Quíron Equine — Setup do banco MS1 Identity & Registry
#
#  Uso:  .\scripts\setup-db.ps1
#  Rode da RAIZ do monorepo.
#
#  Idempotente: pode rodar quantas vezes precisar.
#  ATENCAO: apaga os volumes Docker e as migrations. Sem dados reais ainda.
# ══════════════════════════════════════════════════════════════════

# NAO usar ErrorActionPreference = 'Stop' aqui.
# Comandos nativos (docker, npx) escrevem progresso no stderr, e o
# PowerShell interpretaria isso como excecao. Checamos $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

# PowerShell 7.3+ tem essa flag; garante o mesmo comportamento
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Step($n, $msg) {
    Write-Host ""
    Write-Host "[$n] $msg" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "    OK: $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "    $msg" -ForegroundColor Gray }
function Fail($msg) {
    Write-Host ""
    Write-Host "  ERRO: $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ─── Sanidade ─────────────────────────────────────────────────────
if (-not (Test-Path 'package.json')) {
    Fail "Rode este script da raiz do monorepo (onde esta o package.json)."
}
if (-not (Test-Path '.env')) {
    Fail "Arquivo .env nao encontrado. Rode: Copy-Item .env.example .env"
}

$msPath   = 'apps\ms-identity'
$migrPath = "$msPath\prisma\migrations"

# ─── 1. Limpeza ───────────────────────────────────────────────────
Step 1 "Limpando migrations antigas e volumes Docker"

if (Test-Path $migrPath) {
    Remove-Item -Recurse -Force $migrPath -ErrorAction SilentlyContinue
    Ok "migrations/ removida"
} else {
    Info "migrations/ ja estava limpa"
}

# O Out-Null engole a saida; o stderr do docker e apenas informativo
docker compose down -v *>&1 | Out-Null
Ok "volumes Docker removidos"

docker compose up -d *>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Fail "docker compose up falhou. Verifique se o Docker Desktop esta rodando."
}
Ok "containers iniciados"

Write-Host "    aguardando o PostgreSQL..." -NoNewline
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $health = (docker inspect --format='{{.State.Health.Status}}' vq-db-identity 2>$null)
    if ($health -match 'healthy') { $ready = $true; break }
    Write-Host "." -NoNewline
}
Write-Host ""
if (-not $ready) {
    Fail "PostgreSQL nao ficou pronto em 60s. Rode: docker compose logs db-identity"
}
Ok "PostgreSQL pronto"

# ─── 2. Migration das tabelas ─────────────────────────────────────
Step 2 "Criando as tabelas (migration init_identity_schema)"

Push-Location $msPath
npx dotenv -e ../../.env -- prisma migrate dev --name init_identity_schema --skip-seed
$exit = $LASTEXITCODE
Pop-Location

if ($exit -ne 0) { Fail "prisma migrate dev falhou (exit $exit)" }

$initMigr = Get-ChildItem $migrPath -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*_init_identity_schema' } |
            Select-Object -First 1

if (-not $initMigr) { Fail "Migration init nao foi criada." }

$initSql = Get-Content "$($initMigr.FullName)\migration.sql" -Raw
if ($initSql -notmatch 'CREATE TABLE') {
    Fail "A migration init nao contem CREATE TABLE. Conteudo inesperado em $($initMigr.Name)"
}
Ok "$($initMigr.Name) contem CREATE TABLE"

# ─── 3. Migration do RLS ──────────────────────────────────────────
Step 3 "Criando a migration de Row-Level Security"

Start-Sleep -Seconds 1
$stamp  = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$rlsDir = "$migrPath\${stamp}_enable_rls"
New-Item -ItemType Directory -Path $rlsDir -Force | Out-Null

$rlsSql = @'
-- Row-Level Security -- multitenancy (ADR-001 5.2 / RNF-SEG-004)
--
-- Superusuarios IGNORAM RLS. O runtime deve conectar como
-- quironequine_app, nunca como quironequine.

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_users ON "users";
CREATE POLICY tenant_isolation_users ON "users"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "veterinarians" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_veterinarians ON "veterinarians";
CREATE POLICY tenant_isolation_veterinarians ON "veterinarians"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_owners ON "owners";
CREATE POLICY tenant_isolation_owners ON "owners"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_properties ON "properties";
CREATE POLICY tenant_isolation_properties ON "properties"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "property_owners" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_property_owners ON "property_owners";
CREATE POLICY tenant_isolation_property_owners ON "property_owners"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "animals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_animals ON "animals";
CREATE POLICY tenant_isolation_animals ON "animals"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "animal_transfers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_animal_transfers ON "animal_transfers";
CREATE POLICY tenant_isolation_animal_transfers ON "animal_transfers"
  USING (tenant_id = current_tenant_id());

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_log ON "audit_log";
CREATE POLICY tenant_isolation_audit_log ON "audit_log"
  USING (tenant_id = current_tenant_id());

-- NOTA: "tenants" NAO tem RLS de proposito.
-- E a raiz da hierarquia, consultada no login antes de existir
-- contexto de tenant. Acesso controlado pelo AuthService.
'@

# ATENCAO PowerShell 5.1: Set-Content -Encoding UTF8 grava COM BOM,
# e o PostgreSQL rejeita o BOM ("syntax error at or near"). Gravamos
# via .NET com UTF8Encoding($false) para garantir arquivo sem BOM.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$rlsFile   = Join-Path (Resolve-Path $rlsDir).Path 'migration.sql'
[System.IO.File]::WriteAllText($rlsFile, $rlsSql, $utf8NoBom)

# Confirma que nao ha BOM nos primeiros bytes
$firstBytes = [System.IO.File]::ReadAllBytes($rlsFile)[0..2]
if ($firstBytes[0] -eq 0xEF -and $firstBytes[1] -eq 0xBB -and $firstBytes[2] -eq 0xBF) {
    Fail "O arquivo de migration foi gravado com BOM. Abortando."
}
Ok "${stamp}_enable_rls criada (UTF-8 sem BOM)"

# ─── 4. Aplicar RLS ───────────────────────────────────────────────
Step 4 "Aplicando a migration de RLS"

Push-Location $msPath
npx dotenv -e ../../.env -- prisma migrate dev --skip-seed
$exit = $LASTEXITCODE
Pop-Location

if ($exit -ne 0) { Fail "Falha ao aplicar a migration de RLS (exit $exit)" }
Ok "RLS aplicado"

# ─── 5. Role de aplicacao ─────────────────────────────────────────
Step 5 "Criando a role quironequine_app"

$rolePath = 'infra\postgres-init\01-create-app-role.sql'
if (-not (Test-Path $rolePath)) {
    Fail "Arquivo nao encontrado: $rolePath"
}

# docker cp evita qualquer conversao de encoding que o pipe do
# PowerShell poderia introduzir
docker cp $rolePath vq-db-identity:/tmp/create-app-role.sql *>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Falha ao copiar o arquivo para o container" }

docker exec vq-db-identity psql -U quironequine -d identity -v ON_ERROR_STOP=1 -f /tmp/create-app-role.sql
if ($LASTEXITCODE -ne 0) { Fail "Falha ao criar a role" }
Ok "role criada"

# ─── 6. Seed ──────────────────────────────────────────────────────
Step 6 "Populando com dados de demonstracao"

Push-Location $msPath
npx dotenv -e ../../.env -- tsx prisma/seed.ts
$exit = $LASTEXITCODE
Pop-Location

if ($exit -ne 0) { Fail "Seed falhou (exit $exit)" }
Ok "seed concluido"

# ─── 7. Verificacao ───────────────────────────────────────────────
Step 7 "Verificacao final"
Write-Host ""

Write-Host "  Migrations aplicadas:" -ForegroundColor White
docker exec vq-db-identity psql -U quironequine -d identity -t -c `
  "SELECT '    ' || migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at;"

Write-Host "  Policies de RLS:" -ForegroundColor White
$pc = (docker exec vq-db-identity psql -U quironequine -d identity -t -A -c `
  "SELECT count(*) FROM pg_policies WHERE schemaname='public';")
Write-Host "    $($pc.Trim()) policies (esperado: 8)"

Write-Host "  Roles:" -ForegroundColor White
docker exec vq-db-identity psql -U quironequine -d identity -t -c `
  "SELECT '    ' || rpad(rolname,16) || ' superuser=' || rolsuper || '  bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname LIKE 'quironequine%' ORDER BY rolname;"

Write-Host ""
Write-Host "  Setup concluido." -ForegroundColor Green
Write-Host "  Login de demo: demo@quironequine.com.br / quironequine123" -ForegroundColor Gray
Write-Host "  Proximo: teste de isolamento RLS (Passo 9 do guia)." -ForegroundColor Gray
Write-Host ""