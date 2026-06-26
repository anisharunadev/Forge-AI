# Packages

This directory contains the v2.0 packages for Forge AI. All packages are
**v2.0-only** — Paperclip-era packages have been moved to `archive/paperclip/packages/`.

## v2.0 Packages

| Package | Purpose | Used by |
|---|---|---|
| `connector-events` | Event types for connector state transitions | backend (event bus) |
| `forge-browser` | Visual automation (screenshots, a11y, deployment verification) | apps/forge (Verify phase, audit-uat) |
| `forge-core` | Workflow methodology (vendored open-gsd fork) | apps/forge, backend |
| `forge-pi` | Product intelligence (scanner, knowledge graph, idea scorer, voice clustering) | apps/forge (Ideation, PI, Co-pilot) |
| `forge-terminal-server` | PTY server for the in-app terminal | apps/forge |
| `gsd-core-stub` | GSD white-label stub (63 forge-* commands) | backend (forge_commands.py, gsd_wrapper.py) |
| `gsd-pi-stub` | Re-export of gsd-core-stub for the peripheral layer | backend |
| `mcp-router` | Typed MCP router port + in-process mirror | mcp-servers/jira (workspace dep) |

### 3-Package Spec-Driven Stack (Step 45)

The Forge Command Center groups skills into three tabs:

- **Core workflow** — `forge-core` (always wired)
- **Product intelligence** — `forge-pi` (optional, degrades gracefully)
- **Browser automation** — `forge-browser` (optional, degrades gracefully)

See `docs-site/src/content/docs/architecture/three-package-stack.md`.

## Archived (Paperclip)

The following Paperclip-era packages were archived to `archive/paperclip/packages/`:
`contracts`, `forge-ui`, `mcp-schemas`, `mcp-transport`,
`object-store`, `oidc-clients`, `tenancy-lint`.

For Paperclip code, see `archive/paperclip/`.