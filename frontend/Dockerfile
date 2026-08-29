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
RUN test -n "$VITE_SUPPORT_EMAIL" \
    && test -n "$VITE_LEGAL_ENTITY" \
    && test -n "$VITE_LEGAL_ADDRESS" \
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

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080 8443

CMD ["nginx", "-g", "daemon off;"]
