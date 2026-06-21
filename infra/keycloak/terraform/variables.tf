###############################################################################
# Variables — Forge Keycloak realm provisioning
###############################################################################

variable "keycloak_url" {
  type        = string
  description = "Base URL of the Keycloak instance (no trailing slash), e.g. https://keycloak.forge.example.com"
}

variable "keycloak_admin_user" {
  type        = string
  description = "Keycloak admin username (matches KEYCLOAK_ADMIN env var)"
  default     = "admin"
  sensitive   = false
}

variable "keycloak_admin_password" {
  type        = string
  description = "Keycloak admin password (matches KEYCLOAK_ADMIN_PASSWORD env var). Inject from a secret manager."
  sensitive   = true
}

variable "forge_ui_url" {
  type        = string
  description = "Public base URL of the Forge UI (e.g. https://app.forge.example.com). Used as root URL, redirect URI origin, and web origin for the forge-ui OIDC client."
}

variable "forge_saml_acs_url" {
  type        = string
  description = "SAML assertion consumer service URL for the forge-saml client (e.g. https://app.forge.example.com/saml/acs)."
}

variable "forge_backend_client_secret" {
  type        = string
  description = "OIDC client secret for forge-backend. Inject from a secret manager; rotate every 90 days per the realm policy."
  sensitive   = true
  default     = null
}

# Identity provider placeholders — left as variables so that the realm import
# JSON template can be parameterised per environment without forking the file.
# In dev these can be empty; in prod each is sourced from the corresponding
# IdP's application credentials.
variable "github_client_id" {
  type        = string
  description = "GitHub OAuth app client ID (for the GitHub IdP)"
  default     = ""
}

variable "github_client_secret" {
  type        = string
  description = "GitHub OAuth app client secret"
  sensitive   = true
  default     = ""
}

variable "google_client_id" {
  type        = string
  description = "Google Workspace OAuth client ID"
  default     = ""
}

variable "google_client_secret" {
  type        = string
  description = "Google Workspace OAuth client secret"
  sensitive   = true
  default     = ""
}

variable "okta_entity_id" {
  type        = string
  description = "Okta SAML entity ID (for the Okta SAML IdP)"
  default     = ""
}

variable "okta_sso_url" {
  type        = string
  description = "Okta SAML single-sign-on service URL"
  default     = ""
}

variable "okta_slo_url" {
  type        = string
  description = "Okta SAML single-logout service URL"
  default     = ""
}

variable "azure_ad_client_id" {
  type        = string
  description = "Azure AD / Entra ID OAuth client ID"
  default     = ""
}

variable "azure_ad_client_secret" {
  type        = string
  description = "Azure AD / Entra ID OAuth client secret"
  sensitive   = true
  default     = ""
}

variable "azure_ad_tenant_id" {
  type        = string
  description = "Azure AD / Entra ID tenant ID"
  default     = ""
}
