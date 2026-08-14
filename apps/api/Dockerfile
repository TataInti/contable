FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY . .
RUN npm ci \
    && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate --config apps/api/prisma.config.ts \
    && npm run build -w @contable/api -w @contable/contracts -w @contable/accounting-engine -w @contable/permissions -w @contable/storage
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
