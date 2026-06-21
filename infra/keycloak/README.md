# infra/keycloak — Forge identity provider

This directory provisions the **Forge Keycloak realm** that backs the
`forge-ai/oidc-clients` package. It contains the realm export template, the
Terraform module that provisions the realm against a live Keycloak 26+
instance, and operator runbooks.

## Contents

| Path                            | Purpose                                                                                          |
|---------------------------------|--------------------------------------------------------------------------------------------------|
| `realm-forge.json`              | Canonical Keycloak 26+ realm export. Checked in for review; not provisioned as-is.               |
| `realm-forge.json.template`     | Same export with `${VAR}` placeholders. Rendered by `templatefile()` in `terraform/main.tf`.     |
| `terraform/`                    | HCL module — provisions realm, clients, roles, groups. Outputs client IDs + secrets.             |
| `tenant-provisioning.md`        | Runbook for onboarding a new tenant (group, claims, IdPs).                                       |
| `../auth/keycloak-runbook.md`   | Operator runbook — start Keycloak, import realm, rotate secrets, troubleshoot.                   |

## How to import this realm

### Option 1 — Terraform (preferred, idempotent)

```bash
cd infra/keycloak/terraform

export TF_VAR_keycloak_url="https://keycloak.forge.example.com"
export TF_VAR_keycloak_admin_user="admin"
# Source from your secret manager — never check in a real value
export TF_VAR_keycloak_admin_password="$(aws secretsmanager get-secret-value \
  --secret-id forge/dev/keycloak/admin --query SecretString --output text)"

export TF_VAR_forge_ui_url="https://app.forge.example.com"
export TF_VAR_forge_saml_acs_url="https://app.forge.example.com/saml/acs"
export TF_VAR_forge_backend_client_secret="$(aws secretsmanager get-secret-value \
  --secret-id forge/dev/keycloak/forge-backend --query SecretString --output text)"

terraform init
terraform plan -out tfplan
terraform apply tfplan
```

After apply, the module's outputs expose `realm_id`, `oidc_discovery_url`,
`jwks_url`, and the per-client IDs/secrets.

### Option 2 — Manual import via the Keycloak admin REST API

```bash
# Render the template (envsubst; same ${VAR} syntax as Terraform templatefile())
envsubst < realm-forge.json.template > /tmp/realm-forge.rendered.json

# Get an admin token
ADMIN_TOKEN=$(curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=${KEYCLOAK_ADMIN_USER}" \
  -d "password=${KEYCLOAK_ADMIN_PASSWORD}" \
  | jq -r .access_token)

# Import the realm
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/realm-forge.rendered.json \
  "${KEYCLOAK_URL}/admin/realms"
```

The realm's default admin user (`admin`/`admin`) lives in the `master` realm —
**not** in `forge`. The `forge` realm is intentionally non-registrable
(`registrationAllowed=false`); users are admin-provisioned only.

## How to add a tenant

See `tenant-provisioning.md`. The short version:

1. Create a top-level group `/tenants/<tenant_slug>` in the `forge` realm.
2. Add a `tenant_id` user-attribute to every member of that group.
3. Create a tenant-scoped role (e.g. `forge-tenant-admin`) and assign it to the
   tenant's group.
4. (Optional) Add an IdP — typically one of `github`, `google`, `okta`, or
   `azure-ad` — and alias it to the tenant.

## How to configure identity providers

The realm ships with four IdP **placeholders** (GitHub, Google, Okta SAML,
Azure AD) wired to `${...}` variables. Enable and configure them via:

- **Terraform** — set the corresponding `*_client_id` / `*_client_secret`
  variables, then re-apply. IdP `enabled` flags live in the realm JSON
  template and can be flipped with a one-line patch + re-import.
- **Admin UI** — Realm Settings → Identity Providers → select provider →
  paste client credentials → toggle Enabled → Save.

Per-tenant IdPs (a common requirement) are configured by enabling the same
provider with a tenant-specific alias (e.g. `acme-okta`) and binding the
alias to the `/tenants/acme` group via a `first broker login` flow
post-broker mapper.

## How to test with `curl` / Postman

### Obtain an access token via the authorization-code flow (forge-ui)

```bash
# 1. Open the authorization URL in a browser, complete login + MFA
#    (Keycloak returns a code in the redirect).
AUTH_URL="https://keycloak.forge.example.com/realms/forge/protocol/openid-connect/auth?\
client_id=forge-ui&\
response_type=code&\
scope=openid+email+profile&\
redirect_uri=https://app.forge.example.com/callback&\
code_challenge=...&\
code_challenge_method=S256"

# 2. Exchange the code for tokens
curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/forge/protocol/openid-connect/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=forge-ui" \
  -d "client_secret=" \
  -d "code=${AUTH_CODE}" \
  -d "redirect_uri=https://app.forge.example.com/callback" \
  | jq .
```

### Obtain an access token via direct access grant (forge-backend service)

```bash
curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/forge/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=forge-backend" \
  -d "client_secret=${FORGE_BACKEND_CLIENT_SECRET}" \
  -d "username=${SERVICE_USER}" \
  -d "password=${SERVICE_PASSWORD}" \
  | jq .
```

### Start the device flow (forge-cli)

```bash
DEVICE_CODE=$(curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/forge/protocol/openid-connect/auth/device" \
  -d "client_id=forge-cli" \
  | jq -r .device_code)

# Poll for token
curl -sS -X POST \
  "${KEYCLOAK_URL}/realms/forge/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
  -d "client_id=forge-cli" \
  -d "device_code=${DEVICE_CODE}"
```

### Inspect a token

```bash
# Decode JWT payload (base64url, no verification — for inspection only)
echo "${ACCESS_TOKEN}" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | jq .
```

The expected claims are documented in `infra/auth/jwt-claims.md`.

### Postman

Import the OIDC discovery document at:
```
${KEYCLOAK_URL}/realms/forge/.well-known/openid-configuration
```
Postman will auto-populate the authorization, token, JWKS, and revocation
endpoints. Use the **Authorization Code + PKCE** flow type for `forge-ui`,
**Client Credentials** for `forge-backend`.

## Related

- `../auth/rls-policies.sql` — PostgreSQL RLS policies that depend on
  `tenant_id` claims from these tokens.
- `../auth/tenant-middleware.md` — FastAPI tenant middleware design.
- `../auth/jwt-claims.md` — JWT claim schema and reference tokens.
- `../../packages/oidc-clients/` — TypeScript OIDC client + JWKS cache
  (read-only reference; not modified by this module).
- `../../docs/architecture/decisions/0003-hybrid-mdm-steward-priority.md` —
  rationale for the `forge-steward` role.
