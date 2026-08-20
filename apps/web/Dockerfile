# F2.6: multi-stage, non-root nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build -w @contable/web

FROM nginx:1.28-alpine
RUN addgroup -S contable && adduser -S contable -G contable \
    && chown -R contable:contable /usr/share/nginx/html /var/cache/nginx /var/run
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER contable
EXPOSE 80
