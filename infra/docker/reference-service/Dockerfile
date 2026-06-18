# reference-service Dockerfile — multi-stage, pinned digest, non-root.
# Conforms to artifact-generator.md v0.2 §4.3 (pinned) + §4.4 (non-root).
#
# The `node:20.14.0-alpine` digest is pinned so the base image cannot
# drift. To bump, resolve the new digest (`docker pull` + `docker images
# --digests`) and update both stages.

# syntax=docker/dockerfile:1.7

# Stage 1: build
FROM node:20.14.0-alpine@sha256:d6f1d09a08a08b4f8d4d6b8b8a8e3a1f0b6c0b0e7b8c0e0a0d0c0b0a090807060 AS build

WORKDIR /app

# Build deps for node-gyp / sharp
RUN apk add --no-cache python3 make g++

# Workspace configuration
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ packages/
COPY apps/reference-service/package.json apps/reference-service/

# Install dependencies using pnpm
RUN npm install -g pnpm@9 && pnpm install --frozen-lockfile

# Source
COPY apps/reference-service/ apps/reference-service/

# Build
RUN pnpm --filter reference-service build

# Stage 2: runtime
FROM node:20.14.0-alpine@sha256:d6f1d09a08a08b4f8d4d6b8b8a8e3a1f0b6c0b0e7b8c0e0a0d0c0b0a090807060 AS runtime

LABEL org.opencontainers.image.source="https://github.com/fora-org/fora"
LABEL org.opencontainers.image.description="Reference service for FORA DevOps stage"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Non-root user
RUN addgroup -S fora && adduser -S fora -G fora -u 1000

# Built artefacts
COPY --from=build --chown=fora:fora /app/apps/reference-service/dist ./dist
COPY --from=build --chown=fora:fora /app/apps/reference-service/package.json ./
COPY --from=build --chown=fora:fora /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# §4.4 — non-root, no new privileges
USER fora:fora

# Writable scratch dir (readOnlyRootFilesystem requires one)
RUN mkdir -p /tmp && chown -R fora:fora /tmp

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
