#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [NA VM] Passo 7/7 — Gerar o .env.production com segredos reais
#
# Rode DENTRO da VM, depois de clonar o repositório lá (git clone).
# Este arquivo NUNCA vai pro Git — fica só na VM, mesma regra do
# .env local (ver .gitignore).
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

REPO_DIR="$HOME/vetequine"

if [ ! -d "$REPO_DIR" ]; then
  echo "Não encontrei $REPO_DIR — clone o repositório primeiro:"
  echo "  git clone https://github.com/MarcoTulioSilv/Assistente_veterinario.git $REPO_DIR"
  exit 1
fi

cd "$REPO_DIR"

if [ -f .env.production ]; then
  echo "Já existe .env.production — este script não sobrescreve pra não"
  echo "derrubar segredos já em uso. Apague o arquivo manualmente antes"
  echo "se quiser gerar um novo do zero."
  exit 1
fi

echo "Gerando segredos fortes..."
JWT_SECRET="$(openssl rand -base64 48)"
DB_SUPERUSER_PASSWORD="$(openssl rand -base64 24)"
DB_APP_PASSWORD="$(openssl rand -base64 24)"

read -rp "Domínio da API (ex.: api.seudominio.com.br, sem https://): " API_DOMAIN
read -rp "Domínio do PWA / Cloudflare Pages (ex.: app.seudominio.com.br): " APP_DOMAIN
read -rp "Seu e-mail (pro Let's Encrypt avisar sobre expiração de certificado): " ACME_EMAIL

cp .env.production.example .env.production

# sed -i funciona igual em Ubuntu (GNU sed) — sem a pegadinha do -i ''
# do macOS/BSD que às vezes aparece em tutorial genérico.
sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" .env.production
sed -i "s#<SENHA_SUPERUSER>#${DB_SUPERUSER_PASSWORD}#g" .env.production
sed -i "s#<SENHA_APP>#${DB_APP_PASSWORD}#g" .env.production
sed -i "s#https://api.SEUDOMINIO.com.br#https://${API_DOMAIN}#" .env.production
sed -i "s#https://app.SEUDOMINIO.com.br#https://${APP_DOMAIN}#" .env.production
sed -i "s#^CADDY_ACME_EMAIL=.*#CADDY_ACME_EMAIL=${ACME_EMAIL}#" .env.production

chmod 600 .env.production

echo
echo "✔ .env.production criado em ${REPO_DIR}/.env.production (permissão 600 — só o dono lê)"
echo
echo "Confira os valores que ainda dependem de outras etapas (Google Maps,"
echo "WhatsApp — ficam em branco por enquanto, não bloqueiam o deploy):"
grep -E '^(GOOGLE_MAPS_API_KEY|WHATSAPP_API_)' .env.production || true

cat <<'EOF'

──────────────────────────────────────────────────────────────────
Este arquivo nunca deve ir pro Git. Confirme que está no
.gitignore (já deveria estar, mesma regra do .env de dev):
  grep -F '.env.production' .gitignore
EOF
