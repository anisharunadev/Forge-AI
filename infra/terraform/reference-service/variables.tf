variable "tenant_id" {
  type        = string
  description = "Tenant ID (used for namespacing all resources; §4.7)"
}

variable "env" {
  type        = string
  description = "Environment (dev | staging | prod)"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of dev, staging, prod."
  }
}

variable "service" {
  type        = string
  description = "Service name (kebab-case)"
}

variable "namespace" {
  type        = string
  description = "Kubernetes namespace"
  default     = "default"
}

variable "region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "account_id" {
  type        = string
  description = "AWS account ID (for IAM resource ARNs)"
}

variable "oidc_provider_arn" {
  type        = string
  description = "ARN of the EKS OIDC provider"
}

variable "oidc_provider_url" {
  type        = string
  description = "URL of the EKS OIDC provider (without https://)"
}

variable "github_oidc_provider_arn" {
  type        = string
  description = "ARN of the GitHub Actions OIDC provider (for the deploy role)"
}

variable "repo_owner" {
  type        = string
  description = "GitHub repo owner (for the deploy role OIDC condition)"
}

variable "repo_name" {
  type        = string
  description = "GitHub repo name (for the deploy role OIDC condition)"
}

variable "pr_branch_prefix" {
  type        = string
  description = "Branch pattern the OIDC deploy role will assume (e.g. forge/6.1/)"
  default     = "forge/6.1/"
}

variable "kms_key_arn" {
  type        = string
  description = "KMS key ARN used to encrypt the secret + log group"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days"
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Tags applied to all resources"
  default     = {}
}
