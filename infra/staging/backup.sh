#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Backup diário do staging — bancos (pg_dump por banco) e uploads (fotos,
# laudos). Agendar no cron do servidor (ver o manual):
#   0 3 * * * /opt/quironequine/backup.sh >> /opt/quironequine/backups/backup.log 2>&1
#
# Guarda RETENTION_DAYS dias no próprio servidor. Cópia fora do servidor
# (armazenamento em nuvem do contrato) fica para produção — staging tem só
# dados de homologação, recriáveis pelo seed.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
DEST="backups/$STAMP"
mkdir -p "$DEST"

set -a
# shellcheck disable=SC1091
. ./.env.staging
set +a
compose() { docker compose --env-file .env.staging "$@"; }

for db in identity inventory clinical reporting; do
  # Formato custom (-Fc): comprimido e restaurável seletivamente (pg_restore).
  compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$db" > "$DEST/$db.dump"
done

# Uploads: o volume é lido por um container descartável, sem parar o serviço.
docker run --rm -v quironequine-staging_uploads:/uploads:ro -v "$PWD/$DEST":/out alpine \
  tar -czf /out/uploads.tar.gz -C /uploads .

find backups -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
echo "$(date -Iseconds) backup ok: $DEST ($(du -sh "$DEST" | cut -f1))"
