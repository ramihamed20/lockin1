FROM node:24.16.0-bookworm-slim AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global pnpm@11.19.0 --loglevel=error \
    && pnpm install --frozen-lockfile --reporter=append-only

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_VERSION=local
ARG VITE_SUPPORT_EMAIL
ARG VITE_LEGAL_ENTITY
ARG VITE_LEGAL_ADDRESS
ARG VITE_LEGAL_JURISDICTION
ARG VITE_POLICY_VERSION

# Legal identity and a support destination are launch requirements. They are
# intentionally public build values, never secrets.
#
# The postal address is the exception, and deliberately so. PublicInfoPage
# renders it conditionally, so the application has always been able to omit
# it. An individual running this without a registered company has no address
# to publish that is not their home, and requiring one leaves two ways out:
# publish that, or invent something. The second is exactly what the
# placeholder check below exists to prevent, so the requirement was working
# against itself. The address stays optional here, and a placeholder is still
# rejected whenever one is supplied.
RUN test -n "$VITE_SUPPORT_EMAIL" \
    && test -n "$VITE_LEGAL_ENTITY" \
    && test -n "$VITE_LEGAL_JURISDICTION" \
    && test -n "$VITE_POLICY_VERSION" \
    && case "$VITE_SUPPORT_EMAIL" in *@*.*) ;; *) echo "VITE_SUPPORT_EMAIL must be a valid public contact" >&2; exit 1;; esac \
    && case "$VITE_APP_VERSION" in local|replace-*) echo "VITE_APP_VERSION must be an immutable release identifier" >&2; exit 1;; *) ;; esac \
    && for value in "$VITE_LEGAL_ENTITY" "$VITE_LEGAL_ADDRESS" "$VITE_LEGAL_JURISDICTION" "$VITE_POLICY_VERSION"; do \
         case "$value" in Replace*|replace-*) echo "Legal and policy build values must be approved, not placeholders" >&2; exit 1;; esac; \
       done

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL \
    VITE_LEGAL_ENTITY=$VITE_LEGAL_ENTITY \
    VITE_LEGAL_ADDRESS=$VITE_LEGAL_ADDRESS \
    VITE_LEGAL_JURISDICTION=$VITE_LEGAL_JURISDICTION \
    VITE_POLICY_VERSION=$VITE_POLICY_VERSION

RUN pnpm build

FROM nginx:1.27-alpine

# The edge runs unprivileged, which is a correctness requirement and not only a
# hardening preference.
#
# nginx creates its temporary-path directories at start-up. When the master runs
# as root with a `user` directive set, it then chowns each one to that user --
# and that chown needs CAP_CHOWN, which the production container drops with
# `cap_drop: ALL`. On the container's freshly mounted tmpfs the directories never
# already exist, so the chown always runs, fails with EPERM, and nginx exits
# before it ever binds a port. A read-only root filesystem with all capabilities
# dropped therefore cannot run a root nginx master at all.
#
# Running the master unprivileged removes the operation rather than the
# restriction: nginx leaves the configured user unset when it is not root
# (src/core/nginx.c), and ngx_create_paths() skips the chown entirely for an
# unset user (src/core/ngx_file.c). Nothing needs CAP_CHOWN, and nothing needs
# to be granted back.
#
# 10001 is the same identity the backend and single-host images use, so the
# collected-static volume is readable and there is one uid to grant on the host.
# BusyBox adduser/addgroup, so short flags only: the GNU long options the
# Debian-based images use are not recognised here.
RUN addgroup -S -g 10001 lockin \
    && adduser -S -u 10001 -G lockin -H -D lockin

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/cloudflare-real-ip.conf /etc/nginx/conf.d/00-cloudflare-real-ip.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Both listeners are above 1024, so binding needs no capability either.
USER 10001:10001
EXPOSE 8080 8443

CMD ["nginx", "-g", "daemon off;"]
