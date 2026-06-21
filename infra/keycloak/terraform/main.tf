###############################################################################
# Forge Keycloak Realm — Terraform provisioning
#
# Provisions the `forge` realm, its OIDC/SAML clients, roles, and groups
# against an existing Keycloak 26+ instance. The realm export template
# (realm-forge.json.template) is rendered via the `templatefile()` function
# and imported as a single `keycloak_realm` resource; clients/roles/groups
# are then declared as HCL resources so that drift is visible in plan output
# rather than silently accepted by an opaque JSON import.
#
# NFR-004a — OIDC + SAML + MFA
# ADR-0003 — Hybrid MDM (steward role drives master-data approval)
###############################################################################

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    keycloak = {
      source  = "keycloak/keycloak"
      version = "~> 5.0"
    }
  }
}

provider "keycloak" {
  client_id = "admin-cli"
  username  = var.keycloak_admin_user
  password  = var.keycloak_admin_password
  url       = var.keycloak_url
}

# ---------------------------------------------------------------------------
# Realm — base settings via JSON template; clients/roles/groups are HCL below
# so that Terraform's plan output shows drift.
# ---------------------------------------------------------------------------
data "template_file" "realm_export" {
  template = file("${path.module}/../realm-forge.json.template")
  vars = {
    forge_ui_url            = var.forge_ui_url
    forge_saml_acs_url      = var.forge_saml_acs_url
    forge_backend_client_secret = var.forge_backend_client_secret
    github_client_id        = var.github_client_id
    github_client_secret    = var.github_client_secret
    google_client_id        = var.google_client_id
    google_client_secret    = var.google_client_secret
    okta_entity_id          = var.okta_entity_id
    okta_sso_url            = var.okta_sso_url
    okta_slo_url            = var.okta_slo_url
    azure_ad_client_id      = var.azure_ad_client_id
    azure_ad_client_secret  = var.azure_ad_client_secret
    azure_ad_tenant_id      = var.azure_ad_tenant_id
  }
}

resource "keycloak_realm" "forge" {
  realm   = "forge"
  enabled = true

  # Token lifespan / security knobs
  access_token_lifespan = 900
  sso_session_idle_timeout = 1800
  sso_session_max_lifespan = 36000
  ssl_required = "external"

  # UX knobs
  login_with_email_allowed = true
  verify_email             = true
  reset_password_allowed   = true
  remember_me              = true
  registration_allowed     = false
  edit_username_allowed    = false

  # Brute force
  brute_force_protected = true
  failure_factor        = 5
  wait_increment_seconds = 60
  max_failure_wait_seconds = 900

  # Crypto
  default_signature_algorithm = "RS256"

  # Audit
  events_enabled   = true
  events_expiration = 7776000
  events_listeners = ["jboss-logging", "json-file"]
  admin_events_enabled = true
  admin_events_details_enabled = true

  # i18n
  internationalization_enabled = true
  supported_locales            = ["en", "es", "fr", "de", "ja", "zh-CN"]
  default_locale               = "en"

  # Themes — `forge` is a placeholder; the real theme JAR is mounted into Keycloak
  login_theme   = "forge"
  account_theme = "forge"
  admin_theme   = "forge"
  email_theme   = "forge"

  # The full JSON export is treated as the canonical source of additional
  # realm settings (webAuthn policy, attributes, requiredActions, etc.).
  # We don't rely on the JSON to define clients/roles/groups (see below).
  attributes = {
    webAuthnPolicyRpEntityName            = "Forge AI"
    webAuthnPolicySignatureAlgorithms     = "ES256 RS256"
    _browser_header.xFrameOptions         = "SAMEORIGIN"
    _browser_header.contentSecurityPolicy = "frame-src 'self'; frame-ancestors 'self'; object-src 'none';"
    _browser_header.strictTransportSecurity = "max-age=31536000; includeSubDomains"
  }
}

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------
# forge-ui: public, OIDC, PKCE required, standard flow + direct access grant
resource "keycloak_openid_client" "forge_ui" {
  realm_id  = keycloak_realm.forge.id
  client_id = "forge-ui"
  name      = "Forge UI"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = true
  direct_access_grants_enabled = true
  direct_access_grants_supported = true

  root_url      = var.forge_ui_url
  base_url      = var.forge_ui_url
  redirect_uris = ["${var.forge_ui_url}/*"]
  web_origins   = [var.forge_ui_url]

  pkce_code_challenge_method = "S256"

  login_theme = "forge"
}

# forge-cli: public, OIDC, device flow + direct access grant
resource "keycloak_openid_client" "forge_cli" {
  realm_id  = keycloak_realm.forge.id
  client_id = "forge-cli"
  name      = "Forge CLI"
  enabled   = true

  access_type                  = "PUBLIC"
  standard_flow_enabled        = false
  direct_access_grants_enabled = true

  pkce_code_challenge_method = "S256"

  # OIDC device flow (RFC 8628) — configured via attributes on the realm import.
  # The keycloak provider does not yet expose device-flow flags as first-class
  # arguments, so the realm JSON template remains authoritative for them.
}

# forge-backend: confidential, bearer-style, service accounts + direct access
resource "keycloak_openid_client" "forge_backend" {
  realm_id  = keycloak_realm.forge.id
  client_id = "forge-backend"
  name      = "Forge Backend"
  enabled   = true

  access_type                   = "CONFIDENTIAL"
  standard_flow_enabled         = false
  direct_access_grants_enabled  = true
  service_accounts_enabled      = true

  client_secret = var.forge_backend_client_secret
}

# forge-saml: SAML SP (legacy / partner federation)
resource "keycloak_saml_client" "forge_saml" {
  realm_id  = keycloak_realm.forge.id
  client_id = "forge-saml"
  name      = "Forge SAML"

  enabled = true

  include_authn_statement  = true
  sign_documents           = true
  sign_assertions          = true
  encrypt_assertions       = false
  client_signature_required = false
  force_post_binding       = true

  # Validating alias URL — assertion consumer service
  assertion_consumer_post_url = var.forge_saml_acs_url
  idp_initiated_sso_url_name  = ""

  signature_algorithm    = "RSA_SHA256"
  signature_key_name     = "KEY_ID"
  canonicalization_method = "EXCLUSIVE"
}

# ---------------------------------------------------------------------------
# Realm roles (forge-admin, forge-steward, ...)
# ---------------------------------------------------------------------------
locals {
  forge_roles = {
    "forge-admin"      = "Forge platform administrator"
    "forge-steward"    = "Master data steward per ADR-003"
    "forge-architect"  = "Architecture approval authority"
    "forge-security"   = "Security approval authority"
    "forge-deployer"   = "Deployment approval authority"
    "forge-developer"  = "Standard developer"
    "forge-viewer"     = "Read-only access"
  }

  forge_groups = {
    "forge-admins"      = "forge-admin"
    "forge-stewards"    = "forge-steward"
    "forge-architects"  = "forge-architect"
    "security-officers" = "forge-security"
    "deployers"         = "forge-deployer"
    "developers"        = "forge-developer"
    "viewers"           = "forge-viewer"
  }
}

resource "keycloak_role" "realm" {
  for_each = local.forge_roles

  realm_id    = keycloak_realm.forge.id
  name        = each.key
  description = each.value
}

# ---------------------------------------------------------------------------
# Groups with role assignments
# ---------------------------------------------------------------------------
resource "keycloak_group" "realm" {
  for_each = local.forge_groups

  realm_id = keycloak_realm.forge.id
  name     = each.key
}

resource "keycloak_group_roles" "realm" {
  for_each = local.forge_groups

  realm_id = keycloak_realm.forge.id
  group_id = keycloak_group.realm[each.key].id

  role_ids = [
    keycloak_role.realm[each.value].id
  ]
}
