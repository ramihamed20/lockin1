# Single-image build for a managed container host: the SPA, the Django API and
# nginx in one container, on one origin. The VPS deployment uses the separate
# backend/ and frontend/ images through compose.production.yaml; both are built
# from this same source with the same release contract.

# Debian provides the native runtime support expected by Vite's build tooling.
FROM node:24.16.0-bookworm-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
# Install the package-manager version declared by the frontend explicitly. This
# avoids Corepack signature/key drift in hosted Docker builders.
RUN npm install --global pnpm@11.19.0 --loglevel=error
RUN pnpm --version && pnpm install --frozen-lockfile --reporter=append-only
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

RUN addgroup --system --gid 10001 lockin \
    && adduser --system --uid 10001 --ingroup lockin --home /home/lockin lockin

WORKDIR /app
COPY backend/pyproject.toml backend/README.md ./
COPY backend/apps ./apps
COPY backend/config ./config
COPY backend/platform_core ./platform_core
COPY backend/manage.py ./
RUN python -m pip install . \
    && mkdir -p /app/media /app/staticfiles /srv/lockin/app

COPY --from=frontend-build /frontend/dist /srv/lockin/app
COPY deploy/container-host/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/container-host/start.sh /usr/local/bin/lockin-start
RUN chmod 0555 /usr/local/bin/lockin-start

# nginx and Gunicorn both run unprivileged. The listener is above 1024, and the
# writable paths below are the only state either process needs.
#
# Deliberately no /var/cache/nginx: that path belongs to the Alpine and official
# nginx images. This stage installs Debian's nginx, which compiles its temporary
# paths under /var/lib/nginx and never creates a cache directory, so chown'ing
# it failed the build outright. Nothing in this deployment sets proxy_cache_path
# or overrides a *_temp_path either, so /var/lib/nginx below is the whole of it.
RUN chown -R lockin:lockin \
        /app/media \
        /app/staticfiles \
        /etc/nginx/conf.d \
        /var/lib/nginx \
        /var/log/nginx

USER 10001:10001
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/lockin-start"]
