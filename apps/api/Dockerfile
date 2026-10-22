# F2.6: multi-stage, non-root, sin secretos en capas.
FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --include=dev
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build node node_modules/prisma/build/index.js generate --config apps/api/prisma.config.ts \
    && npm run build -w @contable/contracts -w @contable/accounting-engine -w @contable/permissions -w @contable/storage -w @contable/tax-engine \
    && npm run build -w @contable/api

FROM node:22.23.4-alpine
RUN addgroup -S contable && adduser -S contable -G contable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/accounting-engine/dist ./packages/accounting-engine/dist
COPY --from=build /app/packages/accounting-engine/package.json ./packages/accounting-engine/package.json
COPY --from=build /app/packages/permissions/dist ./packages/permissions/dist
COPY --from=build /app/packages/permissions/package.json ./packages/permissions/package.json
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
COPY --from=build /app/packages/storage/package.json ./packages/storage/package.json
COPY --from=build /app/packages/tax-engine/dist ./packages/tax-engine/dist
COPY --from=build /app/packages/tax-engine/package.json ./packages/tax-engine/package.json
USER contable
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
