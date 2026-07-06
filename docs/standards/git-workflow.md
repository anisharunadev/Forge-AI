# Standard: Git Workflow

> **Status:** ✅ Canonical — every PR follows this workflow
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/.github/` + `CODEOWNERS`
> **Last updated:** 2026-06-30

---

## Purpose

Forge uses a trunk-based workflow with short-lived feature branches, mandatory code review, and CI-enforced quality gates. This document codifies the **branch strategy, commit conventions, PR template, and merge process** that keeps the main branch shippable.

---

## Source of truth

- **This file** — `/workspace/docs/standards/git-workflow.md`
- **CODEOWNERS** — `.github/CODEOWNERS`
- **PR template** — `.github/pull_request_template.md`
- **Branch protection** — GitHub Settings → Branches → `main`
- **CI workflows** — `.github/workflows/`

---

## 1. Branch strategy (trunk-based)

### 1.1 — One long-lived branch: `main`

The `main` branch is always shippable. Every commit on `main` is deployable to staging.

### 1.2 — Short-lived feature branches

```
main ───────────────────────────────────────────────►
       \      /       /          /         /
        feat/abc ──/───── /─/──── /────────
        fix/xyz ───────/─
        chore/cleanup ────────/
```

**Naming:**
- `feat/<short-kebab-name>` — new feature
- `fix/<short-kebab-name>` — bug fix
- `chore/<short-kebab-name>` — refactor, tooling, docs
- `hotfix/<short-kebab-name>` — urgent production fix

**Lifetime:** Open the branch, push commits, merge via PR. Delete after merge. **No long-lived branches.**

### 1.3 — Release branches (rare)

For multi-week release coordination, branch from `main` as `release/<version>`. Bug fixes go to both `release/<version>` AND `main` (cherry-pick).

---

## 2. Commit conventions (Conventional Commits)

### 2.1 — Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `chore` — refactor, tooling, deps
- `docs` — documentation only
- `style` — formatting, missing semicolons
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — add missing tests
- `perf` — performance improvement

**Scope** — the area of the codebase affected (matches folder or feature):
- `agents` — LangGraph sub-graphs
- `api` — backend API routes
- `ui` — frontend components
- `auth` — authentication
- `governance` — guardrails / approvals
- `seeds` — seed management
- `docs` — documentation

### 2.2 — Examples

```
feat(seeds): add dual-write to ArtifactRegistry + AuditEvent

Adds the dual-write pattern from F-502. POST /seeds/{name}/apply now
writes to both `artifacts` (queryability) and `audit_events` (audit trail).
The override flag (allow_in_prod) is itself audited.

Refs F-502.
```

```
fix(auth): coerce Keycloak tenant_id slug to UUID via uuid5

Keycloak's tenant_id user attribute can be either a real UUID
(production) or a human-readable slug (dev demo realm). The auth
flow was failing on slug-based tenants.

Refs F-123.
```

### 2.3 — Subject line rules

- **Imperative mood** — "Add feature" not "Added feature"
- **Lowercase first letter** — "add X" not "Add X"
- **No period at the end**
- **Max 72 characters**
- **No "WIP" in subject** — squash your commits before merging

### 2.4 — Body rules

- Wrap at 72 characters
- Explain **what** and **why**, not **how** (the diff shows how)
- Reference the issue / spec / PR (`Refs F-502`, `Closes #123`)

### 2.5 — Footer rules

- `Refs <ticket>` — reference the ticket
- `Closes <ticket>` — auto-close on merge
- `BREAKING CHANGE: <description>` — note breaking changes

---

## 3. PR template

### 3.1 — `.github/pull_request_template.md`

```markdown
## Summary

<1-2 sentence summary of the change>

## What changed

- <bullet 1>
- <bullet 2>
- <bullet 3>

## Why

<paragraph explaining the motivation>

## How to test

1. <step 1>
2. <step 2>
3. <step 3>

## Constitutional rules

- [ ] **R1** — All LLM traffic through LiteLLM Proxy (no direct SDK)
- [ ] **R2** — Multi-tenancy (every query tenant-scoped)
- [ ] **R3** — Human approval gates (if applicable)
- [ ] **R4** — Typed artifacts (Pydantic with extra="forbid")
- [ ] **R5** — Layer isolation (Org vs Project)
- [ ] **R6** — Audit decorator on every mutating route
- [ ] **R7** — Tracing on every async function
- [ ] **R8** — No hardcoded GitHub/Jira/OpenAI strings
- [ ] **R9-R18** — see architecture-rules.md

## Checklist

- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] `index.md` updated (if adding new doc)
- [ ] Migration added (if schema change)
- [ ] Lighthouse Accessibility ≥ 90 (UI changes)
- [ ] No `console.log` / `print()` left in production code
- [ ] No `bg-black` / `bg-white` (use design tokens)
- [ ] No emoji as UI icons

## Screenshots / recordings

<if UI change>

## Related

- <links to related PRs / docs / specs>
```

---

## 4. CODEOWNERS

### 4.1 — `.github/CODEOWNERS`

```yaml
# Forge AI CODEOWNERS

# Default — leads must approve everything
*                                              @forge-ai-leads

# Backend modules
/backend/app/agents/                          @forge-ai-agents-team @forge-ai-leads
/backend/app/api/                             @forge-ai-platform-team @forge-ai-leads
/backend/app/core/                            @forge-ai-platform-team @forge-ai-leads
/backend/app/db/                              @forge-ai-platform-team @forge-ai-leads
/backend/app/integrations/                    @forge-ai-integrations-team @forge-ai-leads
/backend/app/schemas/                         @forge-ai-platform-team @forge-ai-leads
/backend/app/services/                        @forge-ai-platform-team @forge-ai-leads

# Frontend modules
/apps/forge/app/                              @forge-ai-frontend-team @forge-ai-leads
/apps/forge/components/                       @forge-ai-frontend-team @forge-ai-leads
/apps/forge/lib/                              @forge-ai-frontend-team @forge-ai-leads

# Documentation
/docs/                                        @forge-ai-docs-team @forge-ai-leads

# Standards
/CLAUDE.md                                    @forge-ai-leads
/docs/standards/architecture-rules.md         @forge-ai-leads
```

**Auto-assigned reviewers:** PRs touching a path auto-request reviews from the listed teams.

### 4.2 — Required approvals

- **Default:** 2 approvals from CODEOWNERS
- **Hotfixes to `main`:** 1 approval from a lead
- **Docs-only PRs:** 1 approval from docs team
- **Standards changes:** 2 senior engineer approvals

---

## 5. CI quality gates

Every PR must pass:

| Gate | Tool | Threshold |
|---|---|---|
| **Linting** | Ruff + ESLint + Prettier | No errors |
| **Type-check** | mypy + tsc | No errors |
| **Unit tests** | pytest + Vitest | All pass |
| **Integration tests** | pytest | All pass |
| **E2E tests** | Playwright | All pass on critical journeys |
| **Coverage** | Codecov | services ≥ 80%, components ≥ 60% |
| **Accessibility** | Lighthouse CI | ≥ 90 |
| **R1 grep check** | `grep -rE "from openai\|from anthropic" backend/` | Empty |
| **Build** | Docker | Builds without error |
| **Drift detection** | Custom | No doc drift |

**Any failure blocks merge.**

---

## 6. Merge process

### 6.1 — Squash merge (default)

All PRs are squash-merged. The PR title becomes the commit subject (Conventional Commits format). All intermediate commits are squashed.

**Why:** Clean history on `main`. One commit per PR = easy to revert, easy to bisect.

### 6.2 — Merge commit (rare)

Used for:
- Release branches (preserve merge commit)
- Coordinated multi-PR features (preserve traceability)

### 6.3 — Rebase (never for `main`)

`main` is fast-forwarded from PR branches. No rebasing of merged history.

### 6.4 — Pre-merge checklist

Before clicking "Squash and merge":

- [ ] All CI checks pass
- [ ] 2 approvals from CODEOWNERS
- [ ] No merge conflicts (or resolved)
- [ ] Branch is up to date with `main`
- [ ] PR title follows Conventional Commits format
- [ ] All checklist items checked
- [ ] Documentation updated (if applicable)

---

## 7. Hotfix workflow (production)

### 7.1 — Branch from `main`

```bash
git checkout main
git pull
git checkout -b hotfix/critical-bug
```

### 7.2 — Fix + tests

Make the minimal change. Add a regression test.

### 7.3 — Fast PR + review

1 lead approval required. Skip the 2-approval rule.

### 7.4 — Deploy + cherry-pick

```bash
# Deploy hotfix to production
git checkout main
git pull
./scripts/deploy.sh production

# Cherry-pick to release branches (if any)
git checkout release/1.2
git cherry-pick <hotfix-commit-sha>
```

---

## 8. Pre-commit hook

### 8.1 — `.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files  # max 1MB
      - id: check-merge-conflict

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.0
    hooks:
      - id: ruff
        files: ^backend/
      - id: ruff-format
        files: ^backend/

  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v3.1.0
    hooks:
      - id: prettier
        files: ^apps/forge/

  - repo: https://github.com/pre-commit/mirrors-eslint
    rev: v8.56.0
    hooks:
      - id: eslint
        files: ^apps/forge/
```

### 8.2 — Install

```bash
pip install pre-commit
pre-commit install
```

### 8.3 — Run on demand

```bash
pre-commit run --all-files
```

---

## 9. Versioning (SemVer)

### 9.1 — `MAJOR.MINOR.PATCH`

- **MAJOR** — breaking changes to API contract (e.g. `/api/v1` → `/api/v2`)
- **MINOR** — new features, backward-compatible
- **PATCH** — bug fixes, backward-compatible

### 9.2 — Tagged releases

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

### 9.3 — CHANGELOG.md

Every release has an entry in `CHANGELOG.md`:

```markdown
# Changelog

## [1.2.3] - 2026-06-30

### Added
- Seed management RBAC (F-805)
- Drift detection (4 types)

### Changed
- Settings page: 17 new tabs (backend pending)

### Fixed
- Auth: coerce Keycloak slug to UUID via uuid5

### Security
- Audit events: DB-level immutability listener
```

---

## 10. Code review etiquette

### 10.1 — For authors

- **Small PRs** — under 500 lines diff (excluding generated files)
- **Self-review** — review your own diff before requesting review
- **Context** — link the issue / spec / design doc in the PR
- **Test evidence** — include screenshots / test output in the PR description
- **Respond to feedback** — reply to every comment (resolve, push, or push back)

### 10.2 — For reviewers

- **Review within 1 business day** — Slack the author if blocked
- **Use suggestions** — `Add suggestion` button for small fixes
- **Be specific** — "Move this to its own function" is better than "Refactor"
- **Approve when ready** — don't hold PRs for nitpicks

### 10.3 — Tone

- **Assume good intent** — the author is trying their best
- **Explain why** — "Per Rule 4, this should use extra='forbid'" not "This is wrong"
- **Praise good code** — "Nice use of the dual-write pattern" is motivating
- **No drive-by comments** — if you don't have time to engage, don't comment

---

## 11. Monorepo structure

### 11.1 — Top-level folders

```
forge-ai/
├── apps/
│   └── forge/                  # Next.js frontend
├── backend/                    # FastAPI backend
├── packages/
│   ├── forge-core/             # Skills, agents, commands (canonical)
│   ├── forge-pi/               # Product intelligence
│   ├── forge-browser/          # Visual automation
│   ├── forge-terminal-server/  # PTY bridge
│   ├── connector-events/
│   ├── mcp-router/
│   └── gsd-*-stub/             # Legacy stubs (deprecated)
├── docs/                       # This documentation tree
├── infra/                      # Terraform, Docker
└── .github/                    # CI, templates, CODEOWNERS
```

### 11.2 — Per-folder conventions

- **`apps/forge/`** — TypeScript, ESLint, Prettier, Vitest, Playwright
- **`backend/`** — Python 3.13, Ruff, mypy, pytest
- **`packages/forge-*`** — Follow the same conventions as `backend/` or `apps/forge/` depending on language
- **`docs/`** — Markdown, no code (drift-detected by CI)
- **`infra/`** — Terraform, validated by `terraform validate`

---

## 12. CI workflows (overview)

### 12.1 — `.github/workflows/ci.yml` (top-level orchestrator)

```yaml
name: CI
on: [push, pull_request]

jobs:
  backend:
    uses: ./.github/workflows/ci-backend.yml
  frontend:
    uses: ./.github/workflows/ci-frontend.yml
  drift-detection:
    uses: ./.github/workflows/ci-drift-detection.yml
  lighthouse:
    uses: ./.github/workflows/lighthouse.yml
  security-scan:
    uses: ./.github/workflows/security-scan.yml
  hygiene-grep:
    uses: ./.github/workflows/ci-hygiene-grep.yml
```

### 12.2 — Per-workflow

| Workflow | Purpose |
|---|---|
| `ci-backend.yml` | Ruff + mypy + pytest + coverage |
| `ci-frontend.yml` | ESLint + tsc + Vitest + Playwright |
| `ci-drift-detection.yml` | Verifies docs match code (route counts, schemas) |
| `lighthouse.yml` | Lighthouse CI on preview deploys |
| `security-scan.yml` | Trivy + Snyk + secret scanning |
| `ci-hygiene-grep.yml` | R1 grep (no direct SDK imports) |
| `ci-monorepo.yml` | Per-package builds |
| `ci-seed.yml` | Seed script smoke tests |
| `docs-lint.yml` | Markdown lint + link check |
| `reference-service.yml` | Reference docs deploy |
| `cd-staging.yml` | Auto-deploy to staging on `main` |
| `cd-production.yml` | Manual-approval deploy to production |

---

## 13. Module-discipline gate (Rec #6 — finish one before starting)

**Rule:** A PR that touches any center whose DoD score (per [`docs/product/center-status.md`](../../product/center-status.md)) is below **80%** is **flagged for review** by the module-discipline gate. The gate runs automatically on every PR via `scripts/check-module-discipline.py`; it exits non-zero with a per-center verdict linking to the unfinished work. Brand-new (unscored) centers get a one-time pass — first-touch is free, second touch requires the score.

The bar is **80%** so a center with a couple of pending manual gates can still accept targeted work while one with several stale gates gets a redirect. To unblock a center, finish the manual gates in [`center-status.md`](../../product/center-status.md) (permission, analytics, a11y, responsive) so the score clears the bar.

**Why:** Rec #6 from the audit — Forge was growing modules faster than it was finishing them. A gate that runs at PR time is policy that can't drift; ADRs and docs that say "finish first" eventually get overridden by deadline pressure.

---

## 14. Forbidden patterns

```bash
# ❌ Force-push to main
git push --force origin main  # Branch protection blocks this

# ❌ Commit secrets
git add .env
# Use git-secrets pre-commit hook

# ❌ Large binary files
git add big-dataset.csv  # Use S3 + signed URL

# ❌ Merge commits to main (use squash)
# (unless release branch coordination)

# ❌ "WIP" commits in main history
# Squash them before merging

# ❌ Bypass branch protection
git push --no-verify  # Banned — CI must run

# ❌ Skip pre-commit hooks
git commit --no-verify  # Banned for human commits (allowed for AI agent commits)
```

---

## 14. Verification checklist (per PR)

- [ ] Branch is up to date with `main`
- [ ] No merge conflicts
- [ ] Conventional Commits format
- [ ] PR template fully filled out
- [ ] All CI checks pass
- [ ] 2 CODEOWNERS approvals
- [ ] Documentation updated (if applicable)
- [ ] Migration added (if schema change)
- [ ] Index updated (if adding new doc)
- [ ] Lighthouse Accessibility ≥ 90 (UI changes)
- [ ] No console.log / print() in production code
- [ ] No bg-black / bg-white (design tokens only)
- [ ] No emoji as UI icons
- [ ] No direct SDK imports (R1 grep passes)
- [ ] No hardcoded tenant IDs (R2 grep passes)
- [ ] Squash-merge ready

---

## Related docs

- [Architecture rules](./architecture-rules.md)
- [Coding standards](./coding-standards.md)
- [Design system](./design-system.md)
- [API conventions](./api-conventions.md)
- [Data model](./data-model.md)
- [Testing](./testing.md)
- [LiteLLM integration](./litellm-integration.md)