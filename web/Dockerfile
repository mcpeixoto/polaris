# The web bundle, served by nginx.
#
# The dist/ produced here is the SAME bundle the Electron app ships, built once per
# release. That is deliberate: two builds means the desktop app can drift from the web app
# by a commit nobody notices until a user reports that one of them is broken.

# Node 22.21, not 22.12. The pinned pnpm (see package.json) requires >= 22.13, so the older
# pin could not install it at all — and the failure arrived disguised: corepack tried to
# fetch pnpm first and died on an expired signing key, which reads like a corrupt download.
# The version floor is a real constraint between two pinned things, so it is worth pinning
# to a patch release rather than to `22-alpine`, and worth saying why.
FROM node:22.21-alpine AS build

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/

# pnpm comes from the version pinned in package.json, installed with npm.
#
# `corepack enable` was here and stopped working. Corepack verifies the package manager it
# downloads against a set of signing keys BUNDLED IN THE NODE IMAGE, and those keys are
# frozen at the image's release while the registry's rotate — so a base image pinned for
# reproducibility eventually cannot install anything, and fails with "Cannot find matching
# keyid", which reads like a corrupt download rather than an expired key. Node 22.12 reached
# that point. Nothing in this repository changed; the build simply stopped one day.
#
# `corepack@latest` would fix it by making the build depend on an unpinned package, which is
# the thing the --frozen-lockfile below exists to refuse. Reading the version out of
# package.json keeps one source of truth — the same `packageManager` field corepack read —
# and removes a moving part from the build instead of adding one.
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"

# --frozen-lockfile fails rather than silently resolving a different tree than the one
# that was tested.
RUN pnpm install --frozen-lockfile --filter @polaris/web...

COPY schema/ schema/
COPY web/ web/

ARG GIT_SHA=unknown
ENV VITE_REVISION=${GIT_SHA}
RUN pnpm -C web build

FROM nginx:1.27-alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html

# nginx's own user, and a pid file it can write without root.
RUN touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html
USER nginx

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="Polaris web" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.revision="${GIT_SHA}"

EXPOSE 8080
