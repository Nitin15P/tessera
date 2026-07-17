# One image: the Node server serves both the built frontend and the WebSocket.
#
# Deliberately not two services. Same origin means the page and the socket cannot
# disagree about which host they're on — the single most common way a WebSocket
# app that worked on localhost breaks the moment it's deployed. No CORS, no
# wss:// mismatch, one thing to roll back.

FROM node:22-alpine AS build
WORKDIR /app

# Manifests first so the dependency layer survives source edits.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The lockfile is generated on macOS (arm64), so it pins darwin rollup/esbuild
# binaries and omits the linux-musl ones this Alpine image needs. `npm ci`
# follows it strictly and dies with "Cannot find module
# @rollup/rollup-linux-x64-musl" (npm/cli#4828). Dropping the lockfile and
# running `npm install` forces a clean per-platform resolve, which pulls the
# correct linux-musl binaries. Determinism is traded for a build that works on a
# different OS than it was locked on — the right trade for a container build.
RUN rm -f package-lock.json && npm install --no-audit --no-fund

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Only the three runtime deps (ws, ioredis, pg) — everything else was a build tool.
# Same per-platform reason as the build stage above.
RUN rm -f package-lock.json && \
    npm install --omit=dev --workspace=@tessera/backend --include-workspace-root \
    --no-audit --no-fund

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
# Migrations are plain SQL source (read at boot by db/postgres/migrate.ts), so
# copy them from the build context directly — the build stage never needed them.
COPY db db

EXPOSE 8080

# The board must hydrate from Redis before the first socket is accepted, and
# /healthz reports false until it has.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>r.ok?0:process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/main.js"]
