#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# Gera o .env.staging com segredos aleatórios. Rodar UMA vez, na sua
# máquina (Git Bash serve), e levar o arquivo para o servidor — ver o manual.
#
#   ./generate-env.sh homolog.seudominio.com.br api-homolog.seudominio.com.br voce@email.com
#
# O arquivo sai FORA do repositório (padrão: ~/quironequine-staging.env) —
# nunca commitar. Os mesmos valores vão para os secrets do GitHub (o manual
# diz quais).
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DOMAIN="${1:?uso: ./generate-env.sh <dominio-pwa> <dominio-api> <email-letsencrypt> [arquivo]}"
API_DOMAIN="${2:?informe o domínio da API}"
ACME_EMAIL="${3:?informe o e-mail para os avisos do certificado HTTPS}"
OUT="${4:-$HOME/quironequine-staging.env}"

[ -e "$OUT" ] && { echo "$OUT já existe — não sobrescrevo segredo em uso."; exit 1; }

# Hexadecimal: entra em URL de conexão do Postgres sem precisar de escape.
secret() { openssl rand -hex "$1"; }

umask 077
cat > "$OUT" <<ENV
# Quíron Equine — staging. NÃO COMMITAR. Gerado em $(date -Iseconds).
APP_DOMAIN=${APP_DOMAIN}
API_DOMAIN=${API_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}

# Imagens no GitHub Container Registry (dono do repositório, em minúsculas).
REGISTRY=ghcr.io/marcotuliosilv
IMAGE_TAG=staging

# Usuário das migrations (dono das tabelas). O runtime NUNCA usa este.
POSTGRES_USER=quironequine
POSTGRES_PASSWORD=$(secret 24)

# Senha da role quironequine_app (runtime, sujeita ao RLS).
APP_DB_PASSWORD=$(secret 24)

JWT_SECRET=$(secret 48)
LOG_LEVEL=info

# Senha dos usuários do seed de homologação.
SEED_PASSWORD=Homolog-$(secret 6)
ENV
echo "Gerado: $OUT (permissão só do seu usuário)."
