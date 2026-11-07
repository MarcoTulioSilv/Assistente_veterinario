# ─── Stage 1: build ──────────────────────────────────────────────
# Node 22: o 20 saiu de suporte em abril/2026, e o CI já roda 22 desde o
# adendo do ADR-001 — a imagem de produção não pode ficar num runtime sem
# patch de segurança.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/ms-inventory ./apps/ms-inventory

RUN npm ci
RUN npx prisma generate --schema apps/ms-inventory/prisma/schema.prisma
# turbo (nao "npm run build --workspace"): o dist/ de shared-types e
# shared-middlewares precisa existir antes -- turbo.json resolve isso via
# dependsOn: ["^build"].
RUN npx turbo run build --filter=@quironequine/ms-inventory
# Garante que o diretório exista pro COPY do estágio final, mesmo em serviço
# que gera o cliente do Prisma no node_modules da raiz.
RUN mkdir -p apps/ms-inventory/node_modules

# ─── Stage 2: runtime ────────────────────────────────────────────
# O estágio final reproduz o LAYOUT DO MONOREPO, não achata tudo em /app.
# Duas coisas dependem disso, e as duas quebravam a versão anterior (que
# construía, mas morria ao subir com MODULE_NOT_FOUND — o CI só construía,
# nunca executava, e ninguém viu):
#  - node_modules/@quironequine/shared-* são LINKS SIMBÓLICOS pra packages/*;
#    sem packages/ copiado, apontam pro nada.
#  - o cliente do Prisma é importado por caminho relativo ao dist/ do app
#    ('../node_modules/.prisma/client-*'), gerado dentro de apps/<servico>.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quironequine

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/ms-inventory/package.json ./apps/ms-inventory/package.json
COPY --from=builder /app/apps/ms-inventory/dist ./apps/ms-inventory/dist
COPY --from=builder /app/apps/ms-inventory/prisma ./apps/ms-inventory/prisma
COPY --from=builder /app/apps/ms-inventory/node_modules ./apps/ms-inventory/node_modules

WORKDIR /app/apps/ms-inventory
USER quironequine
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s   CMD node -e "require('http').get('http://localhost:3002/health',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "dist/index.js"]
