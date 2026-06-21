# syntax=docker/dockerfile:1.7
#
# docs-site/Dockerfile — Astro 5 + Starlight multi-stage build.
#
# Produces a small Node 20-alpine runtime image that serves the
# prebuilt static site via `astro preview` on :4321. The runtime
# stage carries only dist/, node_modules/, and package.json — the
# .astro cache and source tree are dropped on the floor.

# ---- Dependencies -------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests first so the install layer is cached independently
# of the source tree. The repo does not always carry a lockfile
# (npm install is used to bootstrap), so generate one if missing.
COPY package.json package-lock.json* ./
RUN if [ ! -f package-lock.json ]; then \
      npm install --package-lock-only --no-audit --no-fund; \
    fi
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ---- Build --------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Reuse the resolved dependency tree from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `astro build` emits static output to ./dist by default.
RUN npm run build

# ---- Runtime ------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

# Non-root user — Alpine ships adduser/addgroup in busybox.
RUN addgroup -g 1001 -S nodejs && adduser -S astro -u 1001

COPY --from=build --chown=astro:nodejs /app/dist ./dist
COPY --from=build --chown=astro:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=astro:nodejs /app/package.json ./package.json

USER astro
EXPOSE 4321

# Astro preview serves ./dist as static files; a HEAD spider against
# `/` confirms the server is up. We pin to 127.0.0.1 so wget prefers
# IPv4 (the Astro preview server only binds 0.0.0.0/4321, which
# some wget builds will not resolve from "localhost").
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4321/ || exit 1

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4321"]
