---
draft: false
title: MCP Servers
description: The 13 first-party MCP servers that power Forge AI's connector framework.
---

Forge's connector framework is built on MCP (Model Context Protocol) servers. There are 13 first-party servers; each wraps a single external system.

## What is this?

The catalog of first-party connectors. Each connector:

- Translates between the external system's data model and Forge's typed artifacts.
- Implements failure states: `pending`, `live`, `degraded`, `down`.
- Emits audit rows on every read and write.
- Authenticates per-tenant using the per-tenant secret.

## The 13 servers

| # | Server | Purpose | Failure modes |
|---|---|---|---|
| 1 | [arch-analyzer](#arch-analyzer) | Code → service boundary detection | repo layout, languages, runtimes |
| 2 | [aws](#aws) | AWS API integration | S3, KMS, IAM, Secrets Manager |
| 3 | [azure-devops](#azure-devops) | Azure DevOps repos + pipelines | repos, pipelines, work items |
| 4 | [clickup](#clickup) | ClickUp tasks | tasks, spaces, lists |
| 5 | [confluence](#confluence) | Confluence docs | pages, spaces, comments |
| 6 | [databricks](#databricks) | Databricks notebooks + jobs | notebooks, jobs, clusters |
| 7 | [figma](#figma) | Figma designs | files, frames, components |
| 8 | [github](#github) | GitHub repos + issues + PRs | repos, issues, PRs, actions |
| 9 | [jira](#jira) | Jira tickets | issues, projects, sprints |
| 10 | [secrets](#secrets) | Secret detection | commit-time secret scanning |
| 11 | [slack](#slack) | Slack chat | channels, messages, threads |
| 12 | [sonarqube](#sonarqube) | SonarQube quality | projects, issues, measures |
| 13 | [zendesk](#zendesk) | Zendesk support | tickets, macros, views |

## arch-analyzer

Detects service boundaries from code. Inputs: repo URL. Outputs: list of services with their entry points, languages, and runtimes.

| Method | Purpose |
|---|---|
| `analyze` | Returns service list with metadata |
| `health` | Liveness check |

Failure modes: unsupported language; monorepo without service markers; private repo without credentials.

## aws

Wraps the AWS APIs the platform uses. Inputs: per-tenant IAM role. Outputs: S3 objects, KMS keys, Secrets Manager secrets.

| Method | Purpose |
|---|---|
| `s3.get` / `s3.put` | Object operations |
| `kms.encrypt` / `kms.decrypt` | Encryption |
| `secrets.get` / `secrets.put` | Secrets |
| `health` | Liveness check |

Failure modes: per-tenant IAM role not configured; KMS key revoked; S3 bucket policy blocks access.

## azure-devops

Wraps Azure DevOps. Inputs: per-tenant PAT or OAuth. Outputs: repos, pipelines, work items.

| Method | Purpose |
|---|---|
| `repos.list` / `repos.get` | Repo metadata |
| `pipelines.list` / `pipelines.get` | Pipeline metadata |
| `work_items.list` / `work_items.get` | Work item metadata |
| `health` | Liveness check |

Failure modes: PAT expired; org not accessible; project archived.

## clickup

Wraps ClickUp. Inputs: per-tenant API token. Outputs: tasks, spaces, lists.

| Method | Purpose |
|---|---|
| `tasks.list` / `tasks.get` | Task metadata |
| `spaces.list` | Space metadata |
| `health` | Liveness check |

Failure modes: API token invalid; workspace archived.

## confluence

Wraps Confluence. Inputs: per-tenant API token. Outputs: pages, spaces, comments.

| Method | Purpose |
|---|---|
| `pages.list` / `pages.get` | Page metadata |
| `spaces.list` | Space metadata |
| `comments.list` | Comment metadata |
| `health` | Liveness check |

Failure modes: API token invalid; space permission revoked.

## databricks

Wraps Databricks. Inputs: per-tenant PAT or service principal. Outputs: notebooks, jobs, clusters.

| Method | Purpose |
|---|---|
| `notebooks.list` / `notebooks.get` | Notebook metadata |
| `jobs.list` / `jobs.get` | Job metadata |
| `clusters.list` | Cluster metadata |
| `health` | Liveness check |

Failure modes: PAT expired; workspace unreachable; job run failed.

## figma

Wraps Figma. Inputs: per-tenant personal access token. Outputs: files, frames, components.

| Method | Purpose |
|---|---|
| `files.list` / `files.get` | File metadata |
| `frames.list` | Frame metadata |
| `components.list` | Component metadata |
| `health` | Liveness check |

Failure modes: PAT invalid; file permission revoked; rate-limited.

## github

Wraps GitHub. Inputs: per-tenant GitHub App or PAT. Outputs: repos, issues, PRs, actions.

| Method | Purpose |
|---|---|
| `repos.list` / `repos.get` | Repo metadata |
| `issues.list` / `issues.get` | Issue metadata |
| `prs.list` / `prs.get` | PR metadata |
| `actions.list` | Workflow run metadata |
| `health` | Liveness check |

Failure modes: GitHub App installation removed; PAT expired; org webhook 410 Gone.

## jira

Wraps Jira. Inputs: per-tenant API token. Outputs: issues, projects, sprints.

| Method | Purpose |
|---|---|
| `issues.list` / `issues.get` | Issue metadata |
| `projects.list` | Project metadata |
| `sprints.list` | Sprint metadata |
| `health` | Liveness check |

Failure modes: API token invalid; project permission revoked; sprint closed.

## secrets

Detects accidentally committed secrets. Inputs: repo URL. Outputs: list of findings with location and severity.

| Method | Purpose |
|---|---|
| `scan` | Run the scanner |
| `findings.list` | List findings |
| `health` | Liveness check |

Failure modes: repo too large (timeout); rule set outdated.

## slack

Wraps Slack. Inputs: per-tenant bot token. Outputs: channels, messages, threads.

| Method | Purpose |
|---|---|
| `channels.list` | Channel metadata |
| `messages.list` / `messages.get` | Message metadata |
| `threads.list` | Thread metadata |
| `health` | Liveness check |

Failure modes: bot token invalid; channel archived; rate-limited.

## sonarqube

Wraps SonarQube. Inputs: per-tenant token. Outputs: projects, issues, measures.

| Method | Purpose |
|---|---|
| `projects.list` / `projects.get` | Project metadata |
| `issues.list` | Issue metadata |
| `measures.get` | Measure metadata |
| `health` | Liveness check |

Failure modes: token invalid; project not analyzed; quality gate failed.

## zendesk

Wraps Zendesk. Inputs: per-tenant API token. Outputs: tickets, macros, views.

| Method | Purpose |
|---|---|
| `tickets.list` / `tickets.get` | Ticket metadata |
| `macros.list` | Macro metadata |
| `views.list` | View metadata |
| `health` | Liveness check |

Failure modes: API token invalid; subdomain wrong; rate-limited.

## Failure state machine

Each server reports one of:

| State | Meaning |
|---|---|
| `pending` | Auth not configured |
| `live` | Last health check < 60s, all OK |
| `degraded` | Last health check < 60s, partial failure |
| `down` | Last health check failed or auth invalid |

The state is polled every 60s and emitted as a metric.

## Adding a new connector

See [Adding connectors](/guides/adding-connectors/).

## Related

- [Adding connectors](/guides/adding-connectors/)
- [Connector framework](/architecture/components/#7-connector-framework-mcp-servers)
