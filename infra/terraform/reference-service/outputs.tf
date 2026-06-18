output "iam_role_arn" {
  value       = aws_iam_role.this.arn
  description = "ARN of the service IAM role assumed by the EKS ServiceAccount"
}

output "deploy_role_arn" {
  value       = aws_iam_role.deploy.arn
  description = "ARN of the GitHub Actions deploy role (OIDC, for the apply job)"
}

output "secrets_manager_secret_arn" {
  value       = aws_secretsmanager_secret.this.arn
  description = "ARN of the Secrets Manager secret (referenced from values.yaml via Helm)"
}

output "log_group_name" {
  value       = aws_cloudwatch_log_group.this.name
  description = "CloudWatch log group name"
}
