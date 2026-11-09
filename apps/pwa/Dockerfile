# ─── Stage 1: build ──────────────────────────────────────────────
# Node 22: mesma política dos outros serviços (apps/ms-identity/Dockerfile,
# apps/bff/Dockerfile) -- imagem de produção não pode ficar num runtime sem
# patch de segurança.
FROM node:22-alpine AS builder
WORKDIR /app

# A URL da API entra NO BUILD (fica embutida no bundle do Next, que roda só
# no browser) -- precisa estar definida antes do `next build`.
ARG NEXT_PUBLIC_BFF_URL
ENV NEXT_PUBLIC_BFF_URL=$NEXT_PUBLIC_BFF_URL
# Chave de NAVEGADOR do Google Maps (map-config.ts): pública por natureza,
# restrita por referenciador HTTP no Google Cloud. Vazia = mapa Leaflet/OSM.
ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY

COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/pwa ./apps/pwa

RUN npm ci
# turbo (não "npm run build --workspace") -- a PWA depende do dist/ de
# shared-types buildado primeiro; turbo.json já resolve isso via
# dependsOn: ["^build"].
RUN npx turbo run build --filter=@quironequine/pwa

# ─── Stage 2: runtime ────────────────────────────────────────────
# output: 'standalone' (next.config.ts) gera em .next/standalone só o
# server.js e os node_modules de fato usados -- muito menor que copiar o
# node_modules inteiro do workspace. Com outputFileTracingRoot apontando pra
# raiz do monorepo, a árvore gerada já reproduz o layout apps/pwa/... que o
# runner espera, igual ao padrão dos outros Dockerfiles.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quironequine

COPY --from=builder /app/apps/pwa/.next/standalone ./
COPY --from=builder /app/apps/pwa/.next/static ./apps/pwa/.next/static
COPY --from=builder /app/apps/pwa/public ./apps/pwa/public

WORKDIR /app/apps/pwa
USER quironequine

ENV PORT=3100
ENV HOSTNAME=0.0.0.0
EXPOSE 3100

# Sem rota /health na PWA (é só front-end) -- /login não exige sessão e
# sempre responde 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "require('http').get('http://localhost:3100/login',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "server.js"]
