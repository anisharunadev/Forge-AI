###############################################################################
# Outputs — Forge Keycloak realm provisioning
###############################################################################

output "realm_id" {
  value       = keycloak_realm.forge.id
  description = "Internal Keycloak UUID of the forge realm (for use by downstream Terraform modules that reference it)."
}

output "realm_name" {
  value       = keycloak_realm.forge.realm
  description = "Realm name (always 'forge')."
}

output "ui_client_id" {
  value       = keycloak_openid_client.forge_ui.client_id
  description = "OIDC client_id of the forge-ui public client (used by the Forge UI to initiate the authorization-code flow)."
}

output "ui_client_secret" {
  value       = null
  description = "forge-ui is a public client (PKCE); no shared secret is issued. Returns null to keep the output shape stable."
}

output "backend_client_id" {
  value       = keycloak_openid_client.forge_backend.client_id
  description = "OIDC client_id of the forge-backend confidential client."
}

output "backend_client_secret" {
  value       = keycloak_openid_client.forge_backend.client_secret
  description = "OIDC client_secret of the forge-backend confidential client. Sensitive — consumed only by the backend's secret manager."
  sensitive   = true
}

output "cli_client_id" {
  value       = keycloak_openid_client.forge_cli.client_id
  description = "OIDC client_id of the forge-cli public client (used by the CLI's device flow)."
}

output "saml_client_id" {
  value       = keycloak_saml_client.forge_saml.client_id
  description = "SAML entity ID / client_id of the forge-saml SAML SP."
}

output "saml_metadata_url" {
  value       = "${var.keycloak_url}/realms/forge/protocol/saml/descriptor"
  description = "Keycloak's published SAML metadata URL for the forge-saml client. Useful when wiring up partner IdPs that need the SP descriptor."
}

output "oidc_discovery_url" {
  value       = "${var.keycloak_url}/realms/forge/.well-known/openid-configuration"
  description = "OIDC discovery document for the forge realm. Backend services use this to fetch JWKS for token verification."
}

output "jwks_url" {
  value       = "${var.keycloak_url}/realms/forge/protocol/openid-connect/certs"
  description = "JWKS URL used by resource servers to verify access-token signatures."
}
