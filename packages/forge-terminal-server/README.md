# forge-terminal-server

PTY sidecar for the Forge Terminal Center (xterm.js backend). Each WebSocket connection spawns one PTY running the user's shell; bytes typed into xterm go to the PTY stdin and PTY stdout is streamed back.

## Install

Workspace member — no install step. pnpm links this package to `apps/forge` automatically.

## Build

```
pnpm --filter @forge-ai/forge-terminal-server build
```

The build copies `src/server.mjs` to `dist/server.mjs` so the `bin` field resolves at install time.

## Run

From the repo root:

```
pnpm dev:terminal
```

That invocation is owned by `apps/forge/package.json`'s `dev:terminal` script, which calls the workspace bin by name. You can also run the script directly:

```
node packages/forge-terminal-server/dist/server.mjs
```

## Endpoint

```
ws://127.0.0.1:4001/ws/terminal
```

Override via `HOST` and `PORT` environment variables.

## Why a package

`node-pty` is a native Node addon (it builds against `libuv` headers during `pnpm install`). Isolating it in a dedicated workspace package keeps `apps/forge/` free of native build artifacts and lets the `dev:terminal` script invoke a single, named bin via the pnpm workspace link. This is the same pattern used by `connector-events` and `forge-core`.
