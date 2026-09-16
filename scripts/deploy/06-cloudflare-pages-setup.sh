#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# [LOCAL] Passo 6/7 — Publicar o PWA no Cloudflare Pages
#
# Rode no seu computador. É tudo console web (dashboard.cloudflare.com)
# — não tem CLI necessário pra essa etapa, mas o script confirma o
# resultado no final testando a URL publicada.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail

cat <<'EOF'
──────────────────────────────────────────────────────────────────
6a. CRIAR CONTA / ACESSAR O CLOUDFLARE
──────────────────────────────────────────────────────────────────
  1. https://dash.cloudflare.com/sign-up (grátis, sem cartão)
  2. Se o domínio de produção já existir e vocês quiserem gerenciar
     o DNS dele pelo Cloudflare também, adicionem o domínio na conta
     agora (Websites > Add a site) — opcional, dá pra usar Pages com
     um domínio próprio gerenciado em outro lugar também.

──────────────────────────────────────────────────────────────────
6b. CONECTAR O REPOSITÓRIO
──────────────────────────────────────────────────────────────────
  1. No dashboard: Workers & Pages > Create > Pages > Connect to Git.
  2. Autorize o acesso ao GitHub e selecione o repositório do
     VetEquine.
  3. Configuração de build:

       Project name:        vetequine-pwa   (vira parte da URL
                             *.vetequine-pwa.pages.dev por padrão)
       Production branch:   develop
       Framework preset:    Next.js
       Build command:       cd apps/pwa && npm run build
       Build output:        apps/pwa/.next
       Root directory:      /   (raiz do monorepo — o Cloudflare
                             precisa ver o workspace inteiro pra
                             resolver @vetequine/shared-types)

  4. Em "Environment variables" (aba antes de clicar em "Save and
     Deploy"), adicione:

       NEXT_PUBLIC_BFF_URL   = https://<SEU_DOMINIO_DA_API>/api/v1
       NEXT_PUBLIC_APP_NAME  = VetEquine
       NODE_VERSION          = 22

     (o domínio da API é o mesmo do script 03 — com https:// e
     /api/v1 no final, diferente do PUBLIC_BFF_URL usado no backend)

  5. Clique em "Save and Deploy". O primeiro build demora alguns
     minutos.

──────────────────────────────────────────────────────────────────
NOTA — Next.js no Cloudflare Pages:
──────────────────────────────────────────────────────────────────
  Se o build falhar reclamando de rotas SSR/Server Components não
  suportadas nativamente, o Cloudflare recomenda o adaptador
  @cloudflare/next-on-pages. Se isso acontecer, volte aqui — é uma
  mudança pequena (adiciona uma dependência + troca o build command),
  não estrutural. Verifique primeiro se o build simples funciona,
  boa parte de um app Next.js "comum" builda direto sem adaptador.

──────────────────────────────────────────────────────────────────
6c. DOMÍNIO PRÓPRIO (opcional, pode usar o *.pages.dev por enquanto)
──────────────────────────────────────────────────────────────────
  Project > Custom domains > Set up a custom domain > digite o
  domínio (ex.: app.seudominio.com.br) > siga as instruções de DNS
  que aparecerem (se o domínio já estiver no Cloudflare, é automático;
  senão, ele pede um CNAME pra criar no seu registrador).

EOF

read -rp "URL final do Pages (ex.: vetequine-pwa.pages.dev ou seu domínio próprio): " PAGES_URL
PAGES_URL="${PAGES_URL#https://}"
PAGES_URL="${PAGES_URL%/}"

echo
echo "Testando https://${PAGES_URL} ..."
if curl -fsS -o /dev/null -w "  HTTP %{http_code}\n" "https://${PAGES_URL}" 2>/dev/null; then
  echo "✔ Respondendo. Abra no navegador pra conferir visualmente:"
  echo "  https://${PAGES_URL}"
else
  echo "Sem resposta ainda — normal se o build ainda estiver rodando."
  echo "Acompanhe o progresso no dashboard (Workers & Pages > projeto > Deployments)."
fi
