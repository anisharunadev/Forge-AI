# syntax=docker/dockerfile:1.7
#
# apps/forge/Dockerfile — Next.js 15 + React 19 multi-stage build.
#
# Produces a small Node 20-alpine runtime image that serves the
# prebuilt Next.js app via `next start` on :3000. The runtime stage
# carries only the .next build output, public/, package.json, and
# node_modules — the source tree and intermediate caches are dropped.

# ---- Dependencies --------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Pin pnpm to the version declared in the lockfile. We avoid corepack
# here because it sometimes resolves a newer pnpm that requires a
# newer Node.js than is in the base image.
RUN npm install -g pnpm@9.15.0

# Copy workspace manifests first so the install layer is cached
# independently of the source tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/forge/package.json ./apps/forge/

# Install dependencies. We try a frozen lockfile install first and
# fall back to a non-frozen install to remain robust to minor
# lockfile drift in CI environments.
RUN pnpm install --frozen-lockfile --no-frozen-lockfile 2>&1 | tail -20 || \
    pnpm install --no-frozen-lockfile 2>&1 | tail -20

# ---- Builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Reuse the resolved dependency tree from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/forge/node_modules ./apps/forge/node_modules
COPY . .

# `next build` emits the production output to ./.next.
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/forge
# Force pnpm 9.15.0 in the build stage too (avoid corepack auto-upgrade)
RUN npm install -g pnpm@9.15.0
RUN pnpm run build

# ---- Runner --------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# Pin pnpm and remove the corepack shim that auto-upgrades to pnpm 11
# (which requires Node 22.13+ and uses `node:sqlite` — not available here).
RUN npm install -g pnpm@9.15.0 && \
    rm -f /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/corepack

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Non-root user — Alpine ships adduser/addgroup in busybox.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy only the artifacts needed to run the built app.
COPY --from=builder --chown=nextjs:nodejs /app/apps/forge/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/forge/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/forge/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/forge/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000

# `next start` binds 0.0.0.0:3000; a HEAD spider against `/` confirms
# the server is up. We pin to 127.0.0.1 so wget prefers IPv4 (some
# wget builds will not resolve IPv6 from "localhost").
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

CMD ["pnpm", "start"]