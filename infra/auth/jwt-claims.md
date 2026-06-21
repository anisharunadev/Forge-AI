# JWT Claim Schema

All tokens issued by the `forge` Keycloak realm carry a fixed set of
claims. The schema below is normative — backend services MUST accept
exactly these claim names and types, and MUST NOT introduce new claims
without a corresponding protocol-mapper change in `realm-forge.json`.

## Standard OIDC claims

| Claim   | Type    | Required | Source                                                | Notes                                                                 |
|---------|---------|----------|-------------------------------------------------------|-----------------------------------------------------------------------|
| `iss`   | string  | yes      | Keycloak realm URL                                    | `${KEYCLOAK_URL}/realms/forge`. Backend MUST verify on every request. |
| `aud`   | string  | yes      | Client id                                             | One of `forge-ui`, `forge-cli`, `forge-backend`, or a SAML alias.      |
| `sub`   | string  | yes      | Keycloak user UUID                                    | Stable across sessions. Used as the application's user id.            |
| `iat`   | integer | yes      | Keycloak                                              | Issued-at (epoch seconds). Access tokens: live for 900s.              |
| `exp`   | integer | yes      | Keycloak                                              | Expiry (epoch seconds). Backend MUST reject `exp <= now`.             |
| `nbf`   | integer | yes      | Keycloak                                              | Not-before (epoch seconds). Equal to `iat` for forge tokens.          |
| `jti`   | string  | yes      | Keycloak                                              | Unique token id. Used for revocation lists and trace correlation.     |
| `email` | string  | yes      | User profile                                          | Already verified by `verifyEmail` realm setting.                      |
| `email_verified` | bool | yes  | User profile                                          | Always `true` for forge-managed users (registration is admin-only).   |

## Forge-specific claims

| Claim          | Type           | Required | Source                          | Notes                                                                                          |
|----------------|----------------|----------|---------------------------------|------------------------------------------------------------------------------------------------|
| `tenant_id`    | string (UUID)  | yes      | `tenant_id` user attribute      | MUST be a valid UUID. NULL tenant (all zeros) is reserved for platform staff with override.   |
| `project_ids`  | array<string>  | no       | `project_ids` user attribute    | Array of project UUIDs the user can read. Empty array = no project access.                     |
| `roles`        | array<string>  | yes      | Realm role mapper               | Multi-valued. Includes both realm roles (`forge-admin`, ...) and tenant roles (`acme-tenant-admin`). |
| `mfa_verified` | bool           | yes      | `mfa_verified` user attribute    | MUST be `true` for any protected endpoint (NFR-004a). Browser/CLI flows enforce this.          |
| `scope`        | string         | no       | Keycloak                        | Space-delimited. Standard OIDC scopes requested by the client.                                  |
| `preferred_username` | string   | no       | User profile                    | The user's email in forge's case.                                                              |

## Type rules

- `tenant_id` is **always** a string-encoded UUID (not a JSON number). The
  backend MUST validate it as a UUIDv4 before use.
- `project_ids` is **always** an array, even when the user has access to
  exactly one project. Backend code MUST handle `[]` without special-casing
  `null` (Keycloak emits `[]` by default).
- `roles` is **always** an array. Backend code MUST NOT treat it as a
  comma-separated string.
- `mfa_verified` is a JSON boolean (`true` / `false`), not the string
  `"true"`. Keycloak's `oidc-usermodel-attribute-mapper` is configured with
  `jsonType.label=boolean` for this mapper.

## Example tokens

### Example 1 — Standard developer (alice@acme.example.com)

```json
{
  "iss":               "https://keycloak.forge.example.com/realms/forge",
  "aud":               "forge-ui",
  "sub":               "9f8e7d6c-5b4a-3210-fedc-ba9876543210",
  "iat":               1719007200,
  "exp":               1719008100,
  "nbf":               1719007200,
  "jti":               "1c2d3e4f-5a6b-7c8d-9e0f-1234567890ab",
  "email":             "alice@acme.example.com",
  "email_verified":    true,
  "preferred_username":"alice@acme.example.com",
  "tenant_id":         "9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1",
  "project_ids":       [
    "a1b2c3d4-1111-2222-3333-444455556666",
    "e5f6a7b8-7777-8888-9999-aaaabbbbcccc"
  ],
  "roles":             ["forge-developer"],
  "mfa_verified":      true,
  "scope":             "openid email profile"
}
```

### Example 2 — Platform admin with cross-tenant override

This is a token issued for a normal user login — the override happens
*per-request* via the `X-Forge-Tenant-Override` header, not via a
different token. The token itself looks like a normal admin token.

```json
{
  "iss":               "https://keycloak.forge.example.com/realms/forge",
  "aud":               "forge-ui",
  "sub":               "00000000-0000-0000-0000-0000000beef0",
  "iat":               1719007200,
  "exp":               1719008100,
  "nbf":               1719007200,
  "jti":               "abcdef01-2345-6789-abcd-ef0123456789",
  "email":             "ops@forge.example.com",
  "email_verified":    true,
  "preferred_username":"ops@forge.example.com",
  "tenant_id":         "00000000-0000-0000-0000-000000000000",
  "project_ids":       [],
  "roles":             ["forge-admin", "forge-security", "forge-architect"],
  "mfa_verified":      true,
  "scope":             "openid email profile"
}
```

The accompanying HTTP request is what makes it cross-tenant:

```
GET /api/v1/projects HTTP/1.1
Host: api.forge.example.com
Authorization: Bearer <token above>
X-Forge-Tenant-Override: 9c3b1e2a-7d40-4f57-9b0e-3a55c1e6e2b1
X-Forge-Audit-Reason:   CUSTOMER-1234 escalation
```

The backend's tenant middleware checks the `forge-admin` role, applies
the override, and writes an `auth.tenant_override` audit event.

### Example 3 — Service account (forge-backend, client credentials)

The `forge-backend` client is confidential and uses the client-credentials
grant. The `sub` is the service account's UUID (Keycloak creates one
implicitly when `serviceAccountsEnabled=true`); `tenant_id` is set on the
service account user profile, NOT minted from a human user.

```json
{
  "iss":               "https://keycloak.forge.example.com/realms/forge",
  "aud":               "forge-backend",
  "sub":               "service-account-forge-backend",
  "iat":               1719007200,
  "exp":               1719008100,
  "nbf":               1719007200,
  "jti":               "deadbeef-cafe-babe-feed-facebadc0de",
  "email":             "service-account-forge-backend@keycloak.local",
  "email_verified":    true,
  "preferred_username":"service-account-forge-backend",
  "tenant_id":         "00000000-0000-0000-0000-000000000000",
  "project_ids":       [],
  "roles":             ["forge-backend-svc"],
  "scope":             "email profile"
}
```

A service account MUST NOT have `forge-admin`. Service-account access to
multiple tenants is brokered by a separate, audited mechanism (e.g. a
signed workload identity token with a `tenant_id` claim issued by a
control-plane service).

## Sample JWKS verification (Python, for reference)

```python
import jwt
from jwt import PyJWKClient

jwks_client = PyJWKClient(
    f"{KEYCLOAK_URL}/realms/forge/protocol/openid-connect/certs",
    cache_keys=True,
    lifespan=300,
)

public_key = jwks_client.get_signing_key_from_jwt(token).key

claims = jwt.decode(
    token,
    public_key,
    algorithms=["RS256"],
    audience="forge-backend",
    issuer=f"{KEYCLOAK_URL}/realms/forge",
    options={"require": ["exp", "iat", "sub", "tenant_id", "roles"]},
    leeway=60,
)

# Hard MFA requirement per NFR-004a
if not claims.get("mfa_verified"):
    raise PermissionError("MFA required")

# tenant_id must be a valid UUID
import uuid
try:
    uuid.UUID(claims["tenant_id"])
except (KeyError, ValueError):
    raise PermissionError("invalid tenant_id claim")
```

## Adding a new claim

1. Add the user attribute (or derive it) in Keycloak.
2. Add or update a protocol mapper on the relevant client in
   `realm-forge.json` (and the `.template` copy).
3. Re-import the realm (or apply the Terraform changes).
4. Update the `decode()` call in the backend to include the new claim in
   `options["require"]` if it's required, or to `options["verify_claims"]`
   if it's optional.
5. Update this file with the new row in the table above.

Adding a claim is a contract change. Treat it as an ADR-bearing PR.
