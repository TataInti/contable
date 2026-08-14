FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY . .
RUN npm ci && npm run build -w @contable/web

FROM nginx:1.28-alpine
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
