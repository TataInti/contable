# F2.6: multi-stage, non-root nginx.
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --include=dev
RUN npm run build -w @contable/contracts -w @contable/design-system \
    && npm run build -w @contable/web

FROM nginx:1.28-alpine
RUN addgroup -S contable && adduser -S contable -G contable \
    && chown -R contable:contable /usr/share/nginx/html /var/cache/nginx /var/run \
    && sed -E -i 's#pid[[:space:]]+/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER contable
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
