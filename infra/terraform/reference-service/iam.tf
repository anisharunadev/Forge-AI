# Reference-service IAM — split from main.tf per artifact-generator v0.2 §3
# Hard rules §4.2 (OIDC, no long-lived keys), §4.6 (least-privilege),
# §4.7 (tenant_id namespacing).

# EKS service-account role (OIDC, no static keys)
resource "aws_iam_role" "this" {
  name = "${var.tenant_id}-${var.env}-${var.service}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EksServiceAccountAssume"
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"
        Principal = {
          Federated = var.oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "${var.oidc_provider_url}:sub" = "system:serviceaccount:${var.namespace}:${var.service}-sa"
            "${var.oidc_provider_url}:aud" = "sts.amazonaws.com"
          }
        }
      },
    ]
  })

  tags = var.tags
}

# Secrets Manager access (least-privilege, scoped to this service's secret)
resource "aws_iam_policy" "secrets" {
  name        = "${var.tenant_id}-${var.env}-${var.service}-secrets-policy"
  description = "Allows ${var.service} to read its own secrets only"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadOwnSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = aws_secretsmanager_secret.this.arn
      },
      {
        Sid       = "DecryptOwnSecret"
        Effect    = "Allow"
        Action    = "kms:Decrypt"
        Resource  = var.kms_key_arn
        Condition = { StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "secrets" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.secrets.arn
}

# CloudWatch Logs write (least-privilege, log-group scoped)
resource "aws_iam_policy" "logs" {
  name        = "${var.tenant_id}-${var.env}-${var.service}-logs-policy"
  description = "Allows ${var.service} to write its own log group only"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteOwnLogGroup"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/${var.tenant_id}/${var.env}/${var.service}:*"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.this.name
  policy_arn = aws_iam_policy.logs.arn
}

# Cross-account deploy role (only the apply job can pass this role;
# §4.6 — iam:PassRole scoped to the deploy role's ARN)
resource "aws_iam_role" "deploy" {
  name = "${var.tenant_id}-${var.env}-${var.service}-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GitHubActionsOidcAssume"
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"
        Principal = {
          Federated = var.github_oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.repo_owner}/${var.repo_name}:ref:refs/heads/${var.pr_branch_prefix}*"
          }
        }
      },
    ]
  })

  tags = var.tags
}

resource "aws_iam_policy" "deploy_passrole" {
  name        = "${var.tenant_id}-${var.env}-${var.service}-deploy-passrole"
  description = "Allow deploy role to pass the service role to ECS/EKS tasks only"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PassServiceRoleOnly"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.this.arn,
        ]
        Condition = { StringEquals = { "iam:PassedToService" = "eks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "deploy_passrole" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy_passrole.arn
}
