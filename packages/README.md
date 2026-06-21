# Packages

This directory contains the v2.0 packages for Forge AI. All packages are
**v2.0-only** — Paperclip-era packages have been moved to `archive/paperclip/packages/`.

## v2.0 Packages

| Package | Purpose | Used by |
|---|---|---|
| `connector-events` | Event types for connector state transitions | backend (event bus) |
| `gsd-core-stub` | GSD white-label stub (63 forge-* commands) | backend (forge_commands.py, gsd_wrapper.py) |
| `gsd-pi-stub` | Re-export of gsd-core-stub for the peripheral layer | backend |
| `mcp-router` | Typed MCP router port + in-process mirror | mcp-servers/jira (workspace dep) |

## Archived (Paperclip)

The following Paperclip-era packages were archived to `archive/paperclip/packages/`:
`contracts`, `forge-ui`, `mcp-schemas`, `mcp-transport`,
`object-store`, `oidc-clients`, `tenancy-lint`.

For Paperclip code, see `archive/paperclip/`.
