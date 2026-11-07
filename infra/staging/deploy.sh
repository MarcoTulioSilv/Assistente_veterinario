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

# Migrations com o usuário dono das tabelas (POSTGRES_USER). O runtime
# conecta como quironequine_app, sujeito ao RLS — nunca com este usuário.
for entry in identity:ms-identity:IDENTITY inventory:ms-inventory:INVENTORY \
             clinical:ms-clinical:CLINICAL reporting:ms-reporting:REPORTING; do
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

docker image prune -f > /dev/null
echo "✔ Staging no ar com a versão $TAG"
