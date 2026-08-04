FROM node:24.16.0-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend ./
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

FROM python:3.13.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx gettext-base \
    && rm -rf /var/lib/apt/lists/* /etc/nginx/sites-enabled/default

WORKDIR /app
COPY backend/pyproject.toml backend/README.md ./
COPY backend/apps ./apps
COPY backend/config ./config
COPY backend/platform_core ./platform_core
COPY backend/manage.py ./
RUN python -m pip install . \
    && mkdir -p /app/media /app/staticfiles /srv/lockin/app

COPY --from=frontend-build /frontend/dist /srv/lockin/app
COPY deploy/render/nginx-demo.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/render/start-demo.sh /usr/local/bin/start-demo
RUN chmod 0555 /usr/local/bin/start-demo

EXPOSE 10000
CMD ["/usr/local/bin/start-demo"]
