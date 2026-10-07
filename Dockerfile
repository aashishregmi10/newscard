# syntax=docker/dockerfile:1
#
# SAAR's servers and website, for any host that runs Docker. See docs/deploy.md.
#
#   target "server"  the reader API and the editorial API (one image, two commands;
#                    the editorial API also runs the news collector)
#   target "site"    Caddy: HTTPS, the website and editorial site, and the routing
#                    of /v1 and /media to the reader API and /api to the editorial API
#
# The mobile app is not in here: it is built by EAS (apps/mobile/eas.json).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# The servers' workspaces, then the website (its own npm project).
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/cms-api ./apps/cms-api
COPY apps/worker ./apps/worker
RUN npm ci
RUN npx tsc -b
COPY apps/cms-web ./apps/cms-web
# The site talks to the editorial API on its own origin (Caddy routes /api).
ENV VITE_CMS_API=/api
RUN npm ci --prefix apps/cms-web && npm run build --prefix apps/cms-web
# Only what the servers need at run time.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/cms-api ./apps/cms-api
COPY --from=build /app/apps/worker ./apps/worker
USER node
# docker-compose.prod.yml chooses which server: apps/api or apps/cms-api.
CMD ["node", "apps/api/dist/server.js"]

FROM caddy:2-alpine AS site
COPY --from=build /app/apps/cms-web/dist /srv/site
COPY infra/Caddyfile /etc/caddy/Caddyfile
