# ─── Stage 1: build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/ms-inventory ./apps/ms-inventory

RUN npm ci
RUN npx prisma generate --schema apps/ms-inventory/prisma/schema.prisma
# turbo (nao "npm run build --workspace") -- mesmo motivo do Dockerfile
# do ms-identity: dist/ de shared-types/shared-middlewares precisa
# existir antes, turbo.json ja resolve isso via dependsOn: ["^build"].
RUN npx turbo run build --filter=@quironequine/ms-inventory

# ─── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quironequine

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ms-inventory/dist ./dist
COPY --from=builder /app/apps/ms-inventory/prisma ./prisma
COPY --from=builder /app/apps/ms-inventory/package.json ./

USER quironequine
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3002/health',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "dist/index.js"]
