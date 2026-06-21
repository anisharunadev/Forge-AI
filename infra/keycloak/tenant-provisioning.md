# Tenant Provisioning Runbook

This runbook describes how to onboard a new tenant into the `forge` Keycloak
realm. Every user belongs to exactly one tenant; tenant_id is the primary
isolation key enforced both at the API layer (JWT claim) and at the database
layer (PostgreSQL RLS — see `infra/auth/rls-policies.sql`).

The key invariant: **a user without a `tenant_id` attribute cannot reach a
protected endpoint**. Platform admins (e.g. `forge-admin`) have a `tenant_id`
of `00000000-0000-0000-0000-000000000000` (the *null tenant*) and explicitly
opt in to cross-tenant operations via the `X-Forge-Tenant-Override` header
(per `infra/auth/tenant-middleware.md`).

## 1. Create a tenant group

The convention is `/tenants/<tenant_slug>` (kebab-case). All tenant members
must belong to this group.

### Via Terraform (preferred — declarative, reviewable)

```hcl
# In infra/keycloak/terraform/tenants/<tenant_slug>.tf
locals {
  tenant_id_acme = "9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1" # the UUID that lives in app DBs
}

resource "keycloak_group" "tenant_acme" {
  realm_id = keycloak_realm.forge.id
  name     = "tenants/acme"
}

# Tenant-scoped role (acme-only) — separate from realm roles
resource "keycloak_role" "acme_tenant_admin" {
  realm_id    = keycloak_realm.forge.id
  name        = "acme-tenant-admin"
  description = "Admin of the Acme tenant (${local.tenant_id_acme})"
}
```

### Via the admin REST API

```bash
GROUP_ID=$(curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "tenants/acme"}' \
  "${KEYCLOAK_URL}/admin/realms/forge/groups" \
  | jq -r .id)
```

## 2. Provision users in the tenant group

```bash
USER_ID=$(curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice@acme.example.com",
    "email": "alice@acme.example.com",
    "emailVerified": true,
    "enabled": true,
    "attributes": {
      "tenant_id":  ["9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1"],
      "project_ids": ["a1b2c3d4-...", "e5f6a7b8-..."]
    }
  }' \
  "${KEYCLOAK_URL}/admin/realms/forge/users" \
  | jq -r .id)

# Add user to the tenant group
curl -sS -X PUT \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/forge/users/${USER_ID}/groups/${GROUP_ID}"

# Assign tenant-scoped role
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '[{"id": "ROLE_UUID", "name": "acme-tenant-admin"}]' \
  -H "Content-Type: application/json" \
  "${KEYCLOAK_URL}/admin/realms/forge/users/${USER_ID}/role-mappings/realm"
```

## 3. Tenant-scoped roles

Forge distinguishes three role scopes:

| Scope            | Defined where                | Example                     | Effect                                                          |
|------------------|------------------------------|-----------------------------|-----------------------------------------------------------------|
| Realm role       | Realm settings → Roles       | `forge-admin`               | Globally authoritative; platform staff.                          |
| Tenant role      | Realm settings → Roles       | `acme-tenant-admin`         | Authority within a single tenant.                               |
| Client role      | Client → Roles               | `forge-ui:project-create`  | Authority for a specific client/application.                    |

The convention is `<tenant_slug>-tenant-<scope>` for tenant roles
(`acme-tenant-admin`, `acme-tenant-steward`, `acme-tenant-viewer`).
The backend authoriser (`infra/auth/tenant-middleware.md`) treats a tenant
role as effective only when the request's `tenant_id` matches the role's
tenant slug prefix. The mapping table lives in the application database
(`tenants/<tenant_slug>/policies.json`) and is loaded at request time.

## 4. Tenant-specific identity providers

Most tenants will federate at least one external IdP — typically the
customer's own Okta tenant or Google Workspace.

### Pattern A — Single shared IdP, per-tenant claim mapping

Keep one IdP per kind (e.g. `okta`), and use Keycloak's
"First Broker Login" flow to read the IdP's group claim and map it to a
`tenant_id` attribute via a *post-broker* identity-provider mapper. This is
the simplest pattern and works for ~80% of tenants.

```bash
# Create a per-tenant IdP alias (e.g. acme-okta)
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @acme-okta-idp.json \
  "${KEYCLOAK_URL}/admin/realms/forge/identity-provider/instances"
```

The IdP JSON looks like:

```json
{
  "alias": "acme-okta",
  "displayName": "Acme (Okta)",
  "providerId": "saml",
  "config": {
    "entityId": "https://acme.okta.com",
    "singleSignOnServiceUrl": "https://acme.okta.com/app/forge/sso/saml",
    "nameIDPolicyFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
  }
}
```

### Pattern B — Hard tenant claim assertion via post-broker mapper

For tenants that demand strict isolation between the IdP and the platform,
add a post-broker mapper that **always** overwrites `tenant_id` with the
tenant's UUID (regardless of what the IdP claims):

```
Mapper type:  oidc-hardcoded-claim-mapper (saml variant for SAML IdPs)
Claim:        tenant_id
Claim value:  9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1
Token claim:  Access token + ID token
```

This means a misconfigured IdP cannot accidentally grant a user the wrong
tenant_id, and a compromised IdP cannot elevate the user across tenants.

## 5. Mapping tenant attributes to JWT claims

The realm export already wires three protocol mappers on `forge-ui` /
`forge-cli` / `forge-backend` (see `realm-forge.json`):

| Mapper                | Source              | Token types            | Notes                                                          |
|-----------------------|---------------------|------------------------|----------------------------------------------------------------|
| `tenant_id`           | user attribute      | access + ID + userinfo | String; must be a valid UUID. Asserted in middleware.         |
| `project_ids`         | user attribute      | access token only      | JSON array; used for project-scoped endpoints.                |
| `roles`               | realm role          | access + ID + userinfo | Multi-valued. Both realm and tenant roles appear.             |
| `mfa_verified`        | user attribute      | access + ID + userinfo | Boolean. Middleware rejects protected calls when false.        |

Tenant provisioning MUST ensure every user has a `tenant_id` attribute
(else login succeeds but every protected call returns 403).

### Per-client claim projection

If a tenant needs additional custom claims (e.g. `cost_center`,
`region`), add a per-client protocol mapper — never modify the realm
mappers. Per-client mappers live in:

```
Admin UI → Clients → <clientId> → Mappers → Add mapper
```

Or via the API:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "cost_center",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-usermodel-attribute-mapper",
    "config": {
      "user.attribute": "cost_center",
      "claim.name": "cost_center",
      "id.token.claim": "true",
      "access.token.claim": "true"
    }
  }' \
  "${KEYCLOAK_URL}/admin/realms/forge/clients/${CLIENT_UUID}/protocol-mappers/models"
```

## 6. Verification checklist

Before flipping a tenant to "live" status:

- [ ] `tenant_id` is a real UUID in the app DB (`SELECT id FROM tenants WHERE slug = '<tenant_slug>';`)
- [ ] At least one user has a `tenant_id` user attribute set to that UUID
- [ ] The user can authenticate via at least one IdP (or password)
- [ ] The user can log in, complete MFA, and obtain an access token
- [ ] The token's `tenant_id` claim equals the app DB UUID
- [ ] A `forge-backend` request with that token can `SELECT` rows from a
      tenant-scoped table; the same token cannot read another tenant's rows
      (verifies RLS — see `infra/auth/rls-policies.sql`)
- [ ] Cross-tenant access via `X-Forge-Tenant-Override` requires the
      `forge-admin` realm role AND is logged to the audit trail
- [ ] Audit events are flowing to `jboss-logging` + `json-file` listeners
