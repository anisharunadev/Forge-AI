# Reference-service core infrastructure — network, observability, secrets
# (IAM lives in iam.tf per artifact-generator v0.2 §3 file list.)

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Secrets Manager secret (reference, never inlined; §4.5)
resource "aws_secretsmanager_secret" "this" {
  name                    = "${var.tenant_id}/${var.env}/${var.service}/secrets"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 30

  tags = var.tags
}

# CloudWatch log group (tenant + env + service prefix; §4.7)
resource "aws_cloudwatch_log_group" "this" {
  name              = "/${var.tenant_id}/${var.env}/${var.service}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn

  tags = var.tags
}
