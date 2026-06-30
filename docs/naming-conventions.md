# Naming Conventions (v2.0)

> LOCKED. The `@fora/*` scope indicates Paperclip-era code. The v2.0 platform does not use it.

## Scope rules

The v2.0 platform uses:

- App names: `forge-dashboard` (`apps/forge/`) — no scope
- New packages: `forge-<name>` or `@forge-ai/<name>` (no `@fora/*`)
- Backend (Python): no scope needed

**If you encounter `@fora/*` references in active code, you MUST:**

1. Archive the code to `archive/paperclip/`
2. Or rename to v2.0 conventions
3. Or remove the reference entirely

**Allowed in v2.0:** `archive/paperclip/**` (history preservation only).

**Forbidden in v2.0:** `apps/`, `backend/`, `packages/`, `mcp-servers/`, `scripts/`, `docs/`, `infra/`, root configs.

When in doubt: **archive**. When certain v2.0 use case: **rename**. When comment-only: replace with descriptive text.

## 3-package naming

```text
packages/forge-core/        The methodology package
packages/forge-pi/          Product intelligence
packages/forge-browser/     Browser automation
```

All skills, agents, and commands use the `forge-*` prefix:

```text
forge-capture
forge-explore
forge-execute-phase
forge-code-review
forge-audit-uat
...
```

## GSD attribution

**NEVER** mention "GSD" in UI, documentation, or user-facing text.
Only mention **open-gsd** in attribution credits:

```
Based on open-gsd spec-driven methodology
```
