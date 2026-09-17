FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/bff ./apps/bff
# turbo (nao "npm run build --workspace") -- bff depende de shared-types/
# shared-middlewares buildados primeiro (dist/ e gitignorado); turbo.json
# ja resolve isso via dependsOn: ["^build"].
RUN npm ci && npx turbo run build --filter=@quironequine/bff

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 quironequine
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/bff/dist ./dist
COPY --from=builder /app/apps/bff/package.json ./
USER quironequine
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1))"
CMD ["node", "dist/index.js"]
