# Archive — `scripts/keycloak-init` (legacy Keycloak realm)

This directory contains the legacy Keycloak realm export that previously
lived under `scripts/keycloak-init/forge-realm.json`. It was archived
during the M1 wiring-gap closure (task T1.5) so the canonical Keycloak
realm definition lives in exactly one place.

## Why it was archived

The codebase shipped **two divergent Keycloak realm definitions** that
disagreed on the role catalog:

| File | Lines | Realm roles |
|---|---|---|
| `infra/keycloak/realm-forge.json` (canonical) | ~716 | 7 — `forge-admin`, `forge-steward`, `forge-architect`, `forge-security`, `forge-deployer`, `forge-developer`, `forge-viewer` |
| `scripts/keycloak-init/forge-realm.json` (legacy) | ~146 | 3 — `forge-admin`, `forge-user`, `forge-viewer` |

The canonical realm export is the one Terraform provisions against
live Keycloak (see `infra/keycloak/terraform/main.tf`) and the one
documented in `infra/keycloak/README.md`. It also carries the SAML
config, the WebAuthn policy, the GitHub/Google/Okta/Azure AD IdP
placeholders, the per-tenant group structure, and the
`forge-steward` rationale (cross-ref
`docs/architecture/decisions/0003-hybrid-mdm-steward-priority.md`).

Booting the stack with the legacy `forge-realm.json` would have
resulted in a stale realm with the wrong role catalog, breaking
RBAC for non-admin personas (`forge-steward`, `forge-architect`,
etc. would not exist) and silently downgrading the tenant model.

## Resolution

`docker-compose.yml` now mounts `infra/keycloak/` (canonical) into
Keycloak's `/opt/keycloak/data/import` instead of the legacy
`scripts/keycloak-init/`. See commit
`chore(keycloak): canonicalize on infra/keycloak/realm-forge.json`.

## Contents preserved

- `forge-realm.json` — exact byte-for-byte copy of the file that
  lived at `scripts/keycloak-init/forge-realm.json` before the
  M1 closure. Kept for archaeology only; **do not** boot Keycloak
  with this file.

## How to roll back (only if absolutely necessary)

1. `cp archive/keycloak-init-legacy/forge-realm.json scripts/keycloak-init/`
2. Revert the compose mount in `docker-compose.yml`:
   ```yaml
   - ./scripts/keycloak-init:/opt/keycloak/data/import:ro
   ```
3. Wipe the Keycloak data volume (`docker compose down -v keycloak`)
   to force a re-import.

In normal operation, prefer the canonical `infra/keycloak/realm-forge.json`.
Re-import instructions live in `infra/keycloak/README.md`.

## See also

- `infra/keycloak/README.md` — provisioning + import runbook
- `infra/keycloak/realm-forge.json` — canonical realm export
- `infra/keycloak/realm-forge.json.template` — `${VAR}` template
  rendered by Terraform `templatefile()`
- `infra/keycloak/terraform/` — HCL module that provisions the realm
- `docker-compose.yml` (search `keycloak-init`) — mount point
