FROM node:24.16.0-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.28.0-alpine AS runtime

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/proxy.conf /etc/nginx/lockin_proxy.conf
COPY --from=builder /app/dist /usr/share/nginx/html
RUN mkdir -p /srv/lockin/static /tmp/nginx-client /tmp/nginx-proxy \
    && chown -R nginx:nginx /srv/lockin /tmp/nginx-client /tmp/nginx-proxy

USER nginx
EXPOSE 8080 8443

HEALTHCHECK --interval=15s --timeout=5s --retries=6 \
  CMD wget -q -O /dev/null --no-check-certificate https://127.0.0.1:8443/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
