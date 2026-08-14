FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY . .
RUN npm ci \
    && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --config apps/api/prisma.config.ts \
    && npm run build -w @contable/worker -w @contable/storage
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
