# ─── Stage 1: build ──────────────────────────────────────────────
# Node 22: o 20 saiu de suporte em abril/2026 (mesma politica do
# apps/ms-identity/Dockerfile) -- imagem de producao nao pode ficar
# num runtime sem patch de seguranca.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/bff ./apps/bff
# turbo (nao "npm run build --workspace") -- bff depende de shared-types/
# shared-middlewares buildados primeiro (dist/ e gitignorado); turbo.json
# ja resolve isso via dependsOn: ["^build"].
RUN npm ci && npx turbo run build --filter=@quironequine/bff

# ─── Stage 2: runtime ────────────────────────────────────────────
# O estagio final reproduz o LAYOUT DO MONOREPO, nao achata tudo em /app
# (mesmo bug ja corrigido no ms-identity: COPY --from=builder /app/node_modules
# ./node_modules sozinho buildava, mas morria no boot com MODULE_NOT_FOUND --
# node_modules/@quironequine/shared-* sao links simbolicos pra packages/*,
# que sem isso apontam pro nada. O build sem smoke test nunca pegava isso).
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quironequine

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/bff/package.json ./apps/bff/package.json
COPY --from=builder /app/apps/bff/dist ./apps/bff/dist

WORKDIR /app/apps/bff
USER quironequine
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1))"
CMD ["node", "dist/index.js"]
