# F2.6: multi-stage, non-root.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --config apps/api/prisma.config.ts \
    && npm run build -w @contable/worker -w @contable/storage

FROM node:22-alpine
RUN addgroup -S contable && adduser -S contable -G contable
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/storage/dist ./packages/storage/dist
USER contable
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
