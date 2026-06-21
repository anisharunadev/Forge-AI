# @opengsd/gsd-core (stub)

This is a **stub** of [`@opengsd/gsd-core`](https://www.npmjs.com/package/@opengsd/gsd-core),
shipped inside the Forge AI monorepo until the upstream package is
published. It exists so that Forge AI can scaffold its white-labeling
layer (FORGE_COMMAND_MAP, GSDWrapper) against a **stable interface**
before the real engine is available.

## What this stub does

* Exports a frozen list `GSD_INTERNAL_COMMANDS` containing 60+ opaque
  command identifiers (e.g. `gsd:phase:discovery`, `gsd:dev:scaffold`).
* Exports `isInternalGsdCommand(name)` and `executeGsdCommand(ctx, name)`
  matching the intended surface of the real package.
* Does NOT contain any execution logic — the real engine will replace it.

## White-labeling (DL-024)

Forge AI users must NEVER see "GSD" anywhere. The bridge is:

```
Forge UI  -->  forge-* command  -->  GSDWrapper  -->  gsd-core (internal)
                                              \-->  gsd:phase:discovery (opaque)
```

The internal command names are deliberately opaque (`:phase:` separators,
not `gsd-discover`) so even a leaked log line does not reveal the engine.

## Replacing this stub

Once `@opengsd/gsd-core` is published on npm:

1. Add the real package to the workspace: `pnpm add -w @opengsd/gsd-core`.
2. Delete `packages/gsd-core-stub/` and `packages/gsd-pi-stub/`.
3. Update `backend/app/services/forge_commands.py` to import from
   `@opengsd/gsd-core` instead of the stub path.
4. Re-run verification — `len(FORGE_COMMAND_MAP)` should still be >= 60
   and every `internal_cmd` field must resolve via `isInternalGsdCommand`.