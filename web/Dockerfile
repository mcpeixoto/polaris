# The web bundle, served by nginx.
#
# The dist/ produced here is the SAME bundle the Electron app ships, built once per
# release. That is deliberate: two builds means the desktop app can drift from the web app
# by a commit nobody notices until a user reports that one of them is broken.

FROM node:22.12-alpine AS build

RUN corepack enable

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
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
