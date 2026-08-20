# F2.6: multi-stage, non-root, sin secretos en capas.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --config apps/api/prisma.config.ts \
    && npm run build -w @contable/api -w @contable/contracts -w @contable/accounting-engine -w @contable/permissions -w @contable/storage

FROM node:22-alpine
RUN addgroup -S contable && adduser -S contable -G contable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/accounting-engine/dist ./packages/accounting-engine/dist
COPY --from=build /app/packages/permissions/dist ./packages/permissions/dist
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
USER contable
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
