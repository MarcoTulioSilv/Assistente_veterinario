#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Deploy do staging — roda NO SERVIDOR, chamado pelo workflow
# deploy-staging.yml (ou à mão, ver o manual de implantação).
#
#   ./deploy.sh <tag>     # tag = commit publicado no GHCR
#
# Ordem: imagens → bancos no ar → migrations (usuário das migrations) →
# role da aplicação (script versionado + senha do .env.staging) → serviços,
# esperando os health checks. Idempotente: rodar de novo não estraga nada.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

TAG="${1:?uso: ./deploy.sh <tag-da-imagem>}"
ENV_FILE=.env.staging
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE (ver o manual de implantação)"; exit 1; }

# A tag que estava no ar fica guardada: as imagens dela são poupadas na
# limpeza do fim, para voltar uma versão sem baixar nada.
PREV_TAG="$(grep '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)"

# A tag implantada fica registrada no .env.staging: um `docker compose up`
# manual depois sobe a MESMA versão, não a última publicada.
if grep -q '^IMAGE_TAG=' "$ENV_FILE"; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" "$ENV_FILE"
else
  echo "IMAGE_TAG=${TAG}" >> "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

echo "▶ Baixando as imagens ($TAG)"
compose pull --quiet

echo "▶ Subindo Postgres e Redis"
compose up -d --wait postgres redis

# Banco de serviço novo. O 00-create-databases.sql só roda quando o volume do
# Postgres é criado; num servidor que já existe, o banco do serviço novo
# (scheduling, Sprint 9 do M3) nasce aqui. Idempotente: o \gexec só executa
# o CREATE quando o SELECT devolve linha, ou seja, quando o banco não existe.
echo "▶ Bancos dos serviços"
for db in identity inventory clinical scheduling reporting; do
  printf "SELECT 'CREATE DATABASE %s' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '%s')\\\\gexec\n" "$db" "$db" |
    compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres > /dev/null
done

# Migrations com o usuário dono das tabelas (POSTGRES_USER). O runtime
# conecta como quironequine_app, sujeito ao RLS — nunca com este usuário.
for entry in identity:ms-identity:IDENTITY inventory:ms-inventory:INVENTORY \
             clinical:ms-clinical:CLINICAL scheduling:ms-scheduling:SCHEDULING \
             reporting:ms-reporting:REPORTING; do
  IFS=: read -r db service var <<< "$entry"
  echo "▶ Migrations: $db"
  compose run --rm --no-deps \
    -e "DATABASE_URL_${var}=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${db}" \
    "$service" npx prisma migrate deploy

  # Role da aplicação + permissões (inclusive as funções SECURITY DEFINER).
  # Depois das migrations: GRANT ON ALL TABLES só alcança o que já existe.
  compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db" < role.sql > /dev/null
done

# O script versionado cria a role com a senha de desenvolvimento; aqui ela
# vira a do .env.staging. Pela entrada padrão, não pela linha de comando —
# assim a senha não aparece na lista de processos.
echo "▶ Senha da role da aplicação"
printf "ALTER ROLE quironequine_app PASSWORD :'pwd';\n" |
  compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v "pwd=${APP_DB_PASSWORD}" > /dev/null

echo "▶ Subindo os serviços (aguardando os health checks)"
compose up -d --wait --remove-orphans

# ─── Limpeza de imagens ──────────────────────────────────────────
# Cada deploy baixa 6 imagens novas com a tag do commit. O `image prune`
# sozinho só apaga imagem SEM tag, então as dos deploys anteriores ficavam
# no disco para sempre. Aqui saem as imagens do projeto (quironequine-*)
# com qualquer tag que não seja a atual nem a anterior. Só roda depois dos
# health checks (set -e): deploy que falhou não apaga nada. Imagem em uso
# por algum contêiner o Docker recusa apagar — o `|| true` só ignora isso.
images() { docker image ls --filter "reference=${REGISTRY}/quironequine-*" --format '{{.Repository}}:{{.Tag}}'; }
# Reaplicar a mesma tag (ou o primeiro deploy) não tem "anterior" útil:
# guarda então a mais recente das outras (a lista vem da mais nova para a
# mais velha).
if [ -z "$PREV_TAG" ] || [ "$PREV_TAG" = "$TAG" ]; then
  PREV_TAG="$(images | sed 's/.*://' | grep -v -x -e "$TAG" -e '<none>' | head -n 1 || true)"
fi
echo "▶ Limpando imagens antigas (mantém $TAG e ${PREV_TAG:-nenhuma anterior})"
images |
  while IFS= read -r ref; do
    tag="${ref##*:}"
    if [ "$tag" = "$TAG" ] || [ "$tag" = "$PREV_TAG" ] || [ "$tag" = "<none>" ]; then
      continue
    fi
    docker image rm "$ref" > /dev/null 2>&1 || true
  done
# Sem tag: camadas órfãs e imagens antigas de postgres/redis/caddy
# substituídas por um pull mais novo da mesma tag.
docker image prune -f > /dev/null
echo "✔ Staging no ar com a versão $TAG"
