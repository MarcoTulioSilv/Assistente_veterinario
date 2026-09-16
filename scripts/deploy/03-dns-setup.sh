#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [LOCAL] Passo 3/7 — Apontar um domínio pro IP da VM
#
# Imprime o guia (varia por registrador de domínio — Registro.br,
# GoDaddy, Cloudflare DNS, etc., todos têm uma tela de "Records"
# parecida) e verifica a propagação de verdade com `dig`.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

read -rp "IP público da VM (do script 01): " VM_IP
read -rp "Domínio que a API vai usar (ex.: api.seudominio.com.br): " API_DOMAIN

cat <<EOF

──────────────────────────────────────────────────────────────────
3a. CRIAR O REGISTRO DNS
──────────────────────────────────────────────────────────────────
No painel do seu registrador de domínio (ou no DNS do Cloudflare, se
o domínio já estiver lá), crie um registro:

  Tipo:   A
  Nome:   ${API_DOMAIN%%.*}   (a parte antes do domínio raiz, ex. "api")
  Valor:  ${VM_IP}
  TTL:    automático ou 300 (5 min) — facilita testar mais rápido

Se o domínio estiver no Cloudflare (mesmo provedor do Pages, ver
script 06): deixe o ícone de nuvem CINZA ("DNS only"), não laranja
("Proxied") — o Caddy da nossa VM precisa validar o certificado TLS
diretamente com a Let's Encrypt, sem o Cloudflare no meio pra essa
etapa inicial. Dá pra ligar o proxy depois, se quiser.

O domínio do PWA (Cloudflare Pages) é configurado separadamente no
script 06 — não precisa de registro A manual, o próprio Cloudflare
Pages cuida disso quando você conecta o domínio lá.

──────────────────────────────────────────────────────────────────
3b. VERIFICAR A PROPAGAÇÃO (pode levar de minutos a ~1h)
──────────────────────────────────────────────────────────────────
EOF

if ! command -v dig >/dev/null 2>&1; then
  echo "Comando 'dig' não encontrado neste terminal — verifique manualmente"
  echo "em https://dnschecker.org/#A/${API_DOMAIN}"
  exit 0
fi

echo "Consultando ${API_DOMAIN}... (Ctrl+C pra parar de tentar)"
for i in $(seq 1 20); do
  RESOLVED=$(dig +short "$API_DOMAIN" A | tail -n1)
  if [ "$RESOLVED" = "$VM_IP" ]; then
    echo "✔ Propagado! ${API_DOMAIN} -> ${RESOLVED}"
    exit 0
  fi
  echo "  ainda não propagou (resolveu: '${RESOLVED:-vazio}') — tentativa $i/20, aguardando 30s..."
  sleep 30
done

echo "Não propagou em 10 minutos de tentativas — normal em alguns"
echo "registradores levar mais tempo. Confira de novo mais tarde com:"
echo "  dig +short ${API_DOMAIN} A"
