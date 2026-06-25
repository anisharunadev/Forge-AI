# Forge Core — Fork Attribution

This package is a fork of [`open-gsd/gsd-core`](https://github.com/open-gsd/gsd-core)
(branch: `next`, HEAD at vendoring time: see `UPSTREAM_SHA` below), rebranded from
"GSD Core" to "Forge Core" for the Forge AI platform.

## Why we forked

Forge is a multi-tenant SDLC operating system. The GSD Core upstream provides a
rich set of spec-driven development slash commands and agent scaffolding that we
needed as the substrate for our `forge-*` command surface. Forking gives us:

1. **Full rebrand control** — every `gsd-*` reference renamed to `forge-*`,
   `gsd-core` → `forge-core`, `.gsd/` → `.forge/`, `@opengsd/gsd-core` →
   `@forge-ai/forge-core`.
2. **Local edits without upstream churn** — we can edit workflow logic in
   place without re-vendoring from upstream on every change.
3. **Path stability** — the engine reads/writes from a known location inside
   this monorepo instead of `~/.claude/gsd-core/`.

## What was preserved

- The MIT license is preserved verbatim in `LICENSE` (required by the upstream
  MIT terms).
- The full upstream `CHANGELOG.md` is preserved verbatim so we can audit the
  fork against upstream history.
- Skill / command / agent file *contents* were renamed (prefix swap) but the
  *structure* and *behavior* are identical to upstream at the time of vendoring.
- Branch templates (`gsd/phase-*` → `forge/phase-*`), config keys, and runtime
  file paths (`.gsd-surface.json` → `.forge-surface.json`, etc.) were renamed.

## What was stripped

- `.git/` (we don't ship git history of the fork — only the snapshot)
- `.github/`, `.githooks/`, `.changeset/` (release tooling, not runtime)
- `.plans/`, `.out-of-scope/` (internal planning artifacts)
- `docs/` (separate docs site, not part of the runtime)

## Syncing with upstream

When pulling new upstream changes:

1. `git fetch upstream next` (where `upstream` points at `open-gsd/gsd-core`)
2. `git rebase upstream/next` to replay local changes
3. Re-run the rename script (kept in `scripts/rename-gsd-to-forge.sh`)
4. Run `pnpm typecheck && pnpm test` to confirm no functional regressions

## UPSTREAM_SHA

```
# This file is rewritten by the vendoring script.
# Format: <upstream-git-sha> <upstream-version>
# Vendored on 2026-06-24 from open-gsd/gsd-core @ next
eef8f9b8c382ed41afae09472970a06be61b527f  1.6.0-rc.3
```
