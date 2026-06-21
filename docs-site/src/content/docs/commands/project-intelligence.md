---
title: Project Intelligence Commands
description: The 6 intel commands — scan repos, deps, services, secrets; summarize; trend.
---

The **project intelligence** category has 6 commands that build and query the project intelligence knowledge graph.

## Commands

| Command | Tier | Approval | Description |
|---|---|---|---|
| `forge-intel-scan-repo` | user | no | Scan repo layout, entrypoints, languages |
| `forge-intel-scan-deps` | user | no | Inventory direct and transitive dependencies |
| `forge-intel-scan-services` | user | no | Map services and their contracts |
| `forge-intel-scan-secrets` | admin | yes | Detect accidentally committed secrets |
| `forge-intel-summarize` | user | no | Generate a project-level executive summary |
| `forge-intel-trend` | user | no | Show velocity and quality trends |

## What is this category for?

The project intelligence commands are how Forge **learns** about a project. They ingest from GitHub, Jira, Confluence, Figma, Slack, SonarQube, and the repo itself. The output is the project intelligence knowledge graph — see [Knowledge graph](/concepts/knowledge-graph/).

## How to use

### Scan a repo

```bash
pnpm forge:exec forge-intel-scan-repo \
  --args '{"repo_url":"https://github.com/acme-corp/acme-api.git","incremental":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

`incremental=true` makes the scanner re-merge rather than replace. The first scan is full; subsequent scans are deltas. The freshness ledger records each scan event.

### Inventory dependencies

```bash
pnpm forge:exec forge-intel-scan-deps \
  --args '{"repo_id":"acme-api","include_transitive":true}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Returns the dependency tree with license, version, and CVE check status. Output is also written to the knowledge graph as `Dependency` nodes.

### Map services

```bash
pnpm forge:exec forge-intel-scan-services \
  --args '{"repo_id":"acme-api"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Identifies service boundaries (each Dockerfile, each `package.json` with a `main`, each FastAPI app) and maps them to their contracts.

### Scan secrets (admin, requires approval)

```bash
pnpm forge:exec forge-intel-scan-secrets \
  --args '{"repo_id":"acme-api","severity":"high"}' \
  --tenant-id acme-corp --project-id acme-api --user-id security@acme.com
```

Detects accidentally committed secrets. Admin + approval because the result may need urgent action and the scan itself touches sensitive data.

### Summarize

```bash
pnpm forge:exec forge-intel-summarize \
  --args '{"repo_id":"acme-api","audience":"exec"}' \
  --tenant-id acme-corp --project-id acme-api --user-id cto@acme.com
```

Produces an executive summary grounded in the knowledge graph. Two audiences: `exec` (one paragraph, key metrics) and `eng` (technical summary with hotspots).

### Trend

```bash
pnpm forge:exec forge-intel-trend \
  --args '{"repo_id":"acme-api","window":"30d"}' \
  --tenant-id acme-corp --project-id acme-api --user-id dev@acme.com
```

Shows velocity (PRs merged, leads time), quality (coverage trend, lint trend), and risk (security findings trend) over the window.

## When to use

| Scenario | Command |
|---|---|
| Onboard a new repo to the KG | `forge-intel-scan-repo` |
| SBOM refresh | `forge-intel-scan-deps` |
| Find all services in a monorepo | `forge-intel-scan-services` |
| Periodic secret scan | `forge-intel-scan-secrets` (admin) |
| Prepare a status update | `forge-intel-summarize` |
| Sprint retrospective | `forge-intel-trend` |

## Scheduling

These commands are designed to run on a schedule. Standard cron:

- `forge-intel-scan-repo` — daily at 02:00 UTC
- `forge-intel-scan-deps` — daily at 02:30 UTC
- `forge-intel-scan-services` — daily at 02:45 UTC
- `forge-intel-scan-secrets` — weekly on Sunday at 03:00 UTC
- `forge-intel-trend` — weekly on Monday at 09:00 UTC

## Related

- [Knowledge graph](/concepts/knowledge-graph/)
- [Security commands](/commands/security/) — `forge-sec-scan` for SAST
- [Ideation commands](/commands/ideation/)
