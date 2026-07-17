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
RUN npm ci

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
RUN npm ci --omit=dev --workspace=@tessera/backend --include-workspace-root

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
# Migrations are read at boot by db/postgres/migrate.ts.
COPY --from=build /app/db db

EXPOSE 8080

# The board must hydrate from Redis before the first socket is accepted, and
# /healthz reports false until it has.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>r.ok?0:process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/main.js"]
