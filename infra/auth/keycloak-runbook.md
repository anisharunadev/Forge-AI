# Keycloak Operator Runbook

How to run, configure, and troubleshoot the Keycloak 26+ instance that
hosts the `forge` realm. This is the on-call companion to
`infra/keycloak/README.md` and the `infra/keycloak/terraform/` module.

## 1. Start Keycloak in dev

```bash
docker run -p 8080:8080 \
  -e KEYCLOAK_ADMIN=admin \
  -e KEYCLOAK_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0.1 \
  start-dev
```

In dev mode Keycloak uses an in-memory H2 database; data is lost on
container restart. For a persistent dev instance, mount a Postgres
database and pass `KC_DB=postgres` + connection env vars. The local
docker-compose is the recommended path (see `docker-compose.yml` for
the local Keycloak service definition).

The admin console lives at <http://localhost:8080/admin/master/console/>.

## 2. Import the realm

### Via the admin UI

1. Log in to the master realm as `admin`.
2. Hover over the realm dropdown (top-left, currently "Master") and click
   **Create Realm**.
3. Click **Browse...**, select `infra/keycloak/realm-forge.json`, and
   click **Create**.

### Via the admin REST API

```bash
# Render the template
envsubst < infra/keycloak/realm-forge.json.template \
  > /tmp/realm-forge.rendered.json

# Get an admin token from the master realm
ADMIN_TOKEN=$(curl -sS -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=admin" \
  | jq -r .access_token)

# Import
curl -sS -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data @/tmp/realm-forge.rendered.json \
  http://localhost:8080/admin/realms
```

### Via Terraform

```bash
cd infra/keycloak/terraform
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

The Terraform path is the canonical provisioning method and is what CI
runs against staging/prod.

## 3. Test login

The simplest browser test:

1. Open the realm's account console:
   <http://localhost:8080/realms/forge/account/>
2. The first user must be created manually (registration is disabled).
   In the admin UI: Realm `forge` → Users → **Add user**.
3. Set a temporary password under the **Credentials** tab; uncheck
   *Temporary* after the user has logged in once and set a real one.
4. Log in at the account console. You will be prompted to:
   - update your password (required action `UPDATE_PASSWORD`)
   - configure TOTP (required action `CONFIGURE_TOTP`)
   - accept the terms (required action `TERMS_AND_CONDITIONS`, if a
     terms file is mounted at `terms/terms-and-conditions.html`)
5. After MFA is set up, the user can authenticate against any of the
   realm's clients.

## 4. Rotate client secrets

The `forge-backend` client has a 90-day rotation policy
(`client.secret.rotation.policy`). To rotate:

1. Admin UI → Realm `forge` → Clients → `forge-backend` → **Credentials**
   tab → **Regenerate**.
2. The new secret is shown **once**. Copy it to your secret manager
   (AWS Secrets Manager, Vault, etc.) — the backend reads from there at
   boot.
3. Restart the backend service to pick up the new secret. There is no
   zero-downtime rotation in v1; track this in the team's debt register.
4. The old secret remains valid for the duration of the existing access
   token (≤15 min). After that, the rotated secret is the only valid
   one.
5. Audit log entry: `client.secret.rotation` event in the JSON-file
   listener.

For `forge-ui` and `forge-cli` (public clients) there is no secret to
rotate — they use PKCE. For SAML (`forge-saml`), the signing keypair
lives in the realm keystore and is rotated via
`Realm settings → Keys → Active → Realm key` → **Generate new keys**.

## 5. Enable / disable MFA

MFA is enforced by the `forge-mfa-choice` sub-flow inside the `browser`
flow. The sub-flow offers **TOTP** (CONFIGURE_TOTP) and **WebAuthn**
(WEAR_AUTHN_REGISTER) as alternatives. To disable MFA entirely
(NEVER in production):

1. Realm `forge` → Authentication → Flows → `browser` → click on the
   `forge-mfa-choice` sub-flow row → set **Requirement** to `DISABLED`.
2. To re-enable, set it back to `REQUIRED`.

To require BOTH TOTP AND WebAuthn (step-up auth for high-risk actions):

1. Duplicate the `forge-mfa-choice` sub-flow.
2. Set the original to `TOTP` only and the duplicate to `WebAuthn` only.
3. Set both to `REQUIRED` in the parent `browser` flow.

Per-user MFA bypass: the `mfa_verified` user attribute can be set to
`true` by an admin to grant a temporary bypass. The required action
`CONFIGURE_TOTP` still runs at next login — the bypass is for users who
have already configured a factor but are temporarily locked out.

## 6. Onboard a new IdP

The realm ships with placeholders for GitHub, Google, Okta (SAML), and
Azure AD. To enable one of them:

### Generic IdP

1. Create the OAuth/SAML app in the upstream provider and obtain the
   client id / secret / metadata.
2. Admin UI → Realm `forge` → Identity Providers → select the provider.
3. Toggle **Enabled** to ON.
4. Paste the credentials. Save.
5. (Optional) Add a post-broker mapper to project a stable
   `tenant_id` onto the federated user (see
   `infra/keycloak/tenant-provisioning.md` §4).

### Per-tenant IdP

For tenants that demand strict isolation between the IdP and the
platform, create a per-tenant IdP alias (e.g. `acme-okta`). The pattern
is in `tenant-provisioning.md` §4.

## 7. Troubleshooting

### Login fails with "Invalid user credentials"

- Check that the user exists and is enabled: Admin UI → Users → search.
- If the user is locked out from brute-force protection, wait
  `maxFailureWaitSeconds` (default 15 min) or unlock from the user's
  **Credentials** tab.

### Login succeeds but every API call returns 403

- The user's `tenant_id` user attribute is unset. Set it under the
  user's **Attributes** tab and force a re-login.
- The JWT's `mfa_verified` is false. Have the user complete the
  TOTP/WebAuthn flow and re-login.

### MFA prompt never appears

- The required action `CONFIGURE_TOTP` may be set as `defaultAction: true`
  but the browser flow's `forge-mfa-choice` sub-flow has its requirement
  set to `CONDITIONAL` instead of `REQUIRED`. Flip it to `REQUIRED`.

### Terraform apply fails with "realm already exists"

- The realm import is not transactional. If a previous `terraform apply`
  failed part-way, the realm may be in a half-applied state. Either
  delete the realm manually and re-apply, or import it into state:
  ```bash
  terraform import keycloak_realm.forge forge
  ```

### pgbouncer `RESET ALL` is too aggressive

- Some GUCs (e.g. `statement_timeout`, `lock_timeout`) are set at the
  pool level via `server_reset_query_after=ROLLBACK`. If those are lost
  on every transaction, move them to the `default_pool_size` config
  block or set them via the application's connection init.

### WebAuthn registration loops forever

- The `forge` theme is a placeholder. If Keycloak can't load the theme,
  the WebAuthn script may not initialise. Mount the real theme JAR
  before testing WebAuthn in prod.

### Where to look for logs

- **Container logs** — `docker logs <keycloak>`.
- **Audit events** — Realm settings → Events → **Config** tab; configure
  the `json-file` listener to write to a mounted volume
  (e.g. `/var/log/keycloak/forge-events.json`).
- **Admin events** — Realm settings → Events → **Admin Events** tab;
  these are admin REST-API calls, not user logins.

## 8. Backup / restore

In dev mode (H2), no backup is possible. In staging/prod:

1. **Realm export** — Admin UI → Realm settings → **Export** →
   Export to a file. Commit the result to the `realm-forge.json`
   sibling directory; this is the canonical export.
2. **DB snapshot** — the realm settings live in the Keycloak DB
   (Postgres in staging/prod). A nightly snapshot is sufficient.
3. **Test restore** — at least quarterly, in a non-prod environment.

## 9. Capacity & scaling

A single Keycloak node handles ~100 logins/sec and ~1k token
verifications/sec on a 2-core / 4-GB container. Scale horizontally
behind a load balancer; sticky sessions are NOT required because
`forge-ui` uses the standard authorization-code flow with PKCE
(stateless on the Keycloak side). For `forge-cli`'s device flow, sticky
sessions are also unnecessary — the device code is server-side state.

## Related

- `infra/keycloak/README.md` — import + IdP + test recipes
- `infra/keycloak/tenant-provisioning.md` — tenant onboarding
- `infra/auth/jwt-claims.md` — token claim schema
- `infra/auth/rls-policies.sql` — DB-side tenant isolation
- `infra/auth/tenant-middleware.md` — request-side tenant enforcement
