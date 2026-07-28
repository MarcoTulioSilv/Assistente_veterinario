# ─── Stage 1: build ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/ms-identity ./apps/ms-identity

RUN npm ci
RUN npx prisma generate --schema apps/ms-identity/prisma/schema.prisma
RUN npm run build --workspace=@vetequine/ms-identity

# ─── Stage 2: runtime ────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 nodejs && adduser -S -u 1001 vetequine

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ms-identity/dist ./dist
COPY --from=builder /app/apps/ms-identity/prisma ./prisma
COPY --from=builder /app/apps/ms-identity/package.json ./

USER vetequine
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/health',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "dist/index.js"]
