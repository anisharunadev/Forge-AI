# Forge AI — Penetration Test Preparation

> Status: Phase 11 / T14
> Linked: NFR-035 (security), `docs/security/SECURITY.md`, `docs/architecture/decisions/ADR-XXXX-rls.md`, ADR for auth, ADR for cost ledger

Pen-tests are not a "scan and forget" exercise. They are a forcing function. This document captures the prep, scope, tools, and remediation cadence for our external pen-test engagements.

## 1. Pre-test checklist

All items must be green before the engagement begins. The pen-test lead signs off on this list at the kickoff call.

- [ ] **Dependencies pinned.** Every `requirements.txt`, `pyproject.toml`, `package.json`, `pnpm-lock.yaml`, and Dockerfile uses exact versions or `~`-pinned ranges. No `*`, no `latest`.
- [ ] **Secrets rotated.** All production credentials rotated in the last 30 days. Pen-test uses fresh, scoped credentials.
- [ ] **MFA enforced** on every human account in scope, including admin and break-glass.
- [ ] **RLS verified.** Every table with tenant data has an enforced RLS policy. Test users exist for at least 3 tenants; cross-tenant access is provably denied.
- [ ] **JWT key rotation** tested: signing and verification with `kid` headers work; old `kid`s are rejected after grace period.
- [ ] **CORS allowlist** is explicit; no `*` origins in production.
- [ ] **Rate limits** configured on auth, terminal websocket, and LLM proxy endpoints.
- [ ] **Audit logging** confirmed for: auth (success/fail), terminal commands, agent invocations, cost ledger writes, approvals.
- [ ] **CSP, HSTS, X-Content-Type-Options, Referrer-Policy** headers verified on every public origin.
- [ ] **Dependency scan** clean for HIGH/CRITICAL: `trivy`, `snyk`, `pip-audit`, `npm audit`.
- [ ] **DAST baseline** clean: weekly `zap-baseline.yml` is green.
- [ ] **Backups verified** and restore-tested in the last 30 days.
- [ ] **Status page** is reachable and has a non-default password.

## 2. Scope

We run three pen-test tracks per year, each one week. The cadence:

| Track           | Cadence    | Tester posture                                  | Output                                |
|-----------------|------------|-------------------------------------------------|---------------------------------------|
| **External black-box** | Annual, Q1 | Outside-in, no credentials, no source access | Full report + retest                  |
| **Internal grey-box**  | Annual, Q2 | Internal network, scoped creds, source view    | Full report + retest                  |
| **White-box code review** | Continuous | Source + threat model + runbooks            | Findings board + monthly review       |

A retest is mandatory after every High/Critical finding. We do not "accept the risk" on Critical findings without a compensating control reviewed by the security team.

## 3. Scope boundaries

### In scope

- `apps/forge/` — Next.js frontend, including auth flows, terminal UI, agent invocation.
- `backend/app/` — FastAPI service, all routes, all websocket endpoints.
- `backend/app/terminal/` — PTY, websocket, audit pipeline.
- `backend/app/agents/` — LangGraph orchestration, tool calls, MCP wrapper.
- `mcp-servers/` — every MCP server's tool surface.
- `infra/keycloak/` — auth realm configuration.
- `infra/ecs/` — task definitions, network policies.
- Postgres + Redis — schema, RLS policies, default privileges.
- LiteLLM Proxy — key issuance, rate limiting, audit logging.

### Out of scope

- Vendor-managed components (Keycloak core, AWS control plane, OpenAI / Anthropic APIs). Findings on these are filed upstream.
- Load testing of upstream LLMs (covered by chaos tests, not pen-tests).
- Denial of service (covered by chaos tests).

## 4. Tools

| Category             | Tools                                                            |
|----------------------|------------------------------------------------------------------|
| **Recon**            | `nmap`, `masscan`, `amass`, `subfinder`                          |
| **Web app**          | OWASP ZAP, Burp Suite Pro, `nikto`                               |
| **API**              | Burp Suite, Postman + Newman, `kiterunner`                       |
| **Auth**             | `jwt_tool`, `hydra`, `patator`, `ffuf`                           |
| **SQLi**             | `sqlmap`                                                         |
| **Deserialization**  | `ysoserial`, `marshalsec`                                        |
| **Container**        | `trivy`, `grype`, `syft`                                         |
| **Cloud**            | `prowler`, `scoutsuite`, `kube-hunter`                           |
| **Source review**    | Semgrep, CodeQL, custom rules in `.github/codeql/`               |

Every test is run from a documented CI pipeline so we can replay it later.

## 5. Test cases (must-execute)

These are the cases we *require* the pen-tester to attempt. They map to NFR-035.

### 5.1 Auth bypass

- [ ] Tampered JWT signature (RS256 → HS256 swap).
- [ ] `alg: none` JWT.
- [ ] `kid` traversal / SQLi.
- [ ] Stolen refresh token replay.
- [ ] Password reset token predictability.
- [ ] MFA bypass via session fixation.
- [ ] OAuth `state` parameter missing.
- [ ] OIDC `nonce` mismatch.

### 5.2 IDOR / authorization

- [ ] Tenant A reads tenant B's workspace (`GET /api/v1/workspaces/<B-id>`).
- [ ] Tenant A mutates tenant B's terminal session.
- [ ] Tenant A reads tenant B's audit log.
- [ ] Cross-tenant agent invocation (tenant A runs agent on tenant B's workspace).

### 5.3 RLS bypass

- [ ] Postgres session-level bypass via `SET ROLE` / `SET LOCAL row_security = off`.
- [ ] Connection-pooling RLS leak (transactions inherit the wrong user).
- [ ] Function-level bypass (SECURITY DEFINER functions that don't filter).
- [ ] Insert/update RLS (most teams only test SELECT).

### 5.4 Prompt injection

- [ ] Indirect injection via uploaded repo (file contents drive agent).
- [ ] Tool-call exfiltration (`gsd_wrapper` with a malicious `command`).
- [ ] Prompt leaking via response metadata.
- [ ] Hidden instructions in WebSocket stream from a shared terminal.
- [ ] Jailbreak of system prompt.

### 5.5 JWT tampering

- [ ] Algorithm downgrade.
- [ ] Key confusion (RS256 public key used as HS256 secret).
- [ ] `exp` / `nbf` boundary.
- [ ] Audience (`aud`) substitution between services.
- [ ] Issuer (`iss`) substitution between environments.

### 5.6 WebSocket / streaming

- [ ] Frame smuggling across protocol boundaries.
- [ ] Oversized frames (DoS).
- [ ] In-band secret leakage (terminal output contains API keys).

### 5.7 Cost ledger abuse

- [ ] Negative amount entries.
- [ ] Rounding exploitation (sub-cent accumulation).
- [ ] Idempotency-key reuse across tenants.
- [ ] Refund > original charge.

### 5.8 Supply chain

- [ ] Typosquatted package in lockfile.
- [ ] Malicious postinstall script.
- [ ] Compromised Docker base image.

## 6. Reporting

Findings are tracked in our issue tracker with the following mandatory fields:

- **CVSS v3.1 base score** (computed, not estimated).
- **OWASP Top 10 / API Top 10 / CWE** mapping.
- **Reproduction steps** — commands and screenshots.
- **Affected versions**.
- **Remediation owner** (CODEOWNERS lookup).
- **Remediation PR link** (or `wontfix` rationale with security sign-off).
- **Retest date**.

Reports are stored in `docs/security/pen-tests/<year>-<vendor>/` and linked from `SECURITY.md`.

## 7. Retest cadence

| Severity     | Initial fix SLA | Retest window                |
|--------------|-----------------|------------------------------|
| Critical     | 7 days          | 14 days after fix            |
| High         | 30 days         | 30 days after fix            |
| Medium       | 90 days         | Next scheduled engagement    |
| Low          | Next quarter    | Next scheduled engagement    |

A finding that misses its SLA escalates to the security steering committee.

## 8. Continuous assurance

Pen-test findings are inputs to our **continuous** security program:

- Every Critical/High becomes a regression test.
- Every Critical/High adds a Semgrep rule to `.github/codeql/`.
- Every Critical/High adds a DAST check to `zap-rules.tsv`.
- Every Critical/High is reviewed in our monthly security review.

We don't pen-test once a year and forget about it. The pen-test is a snapshot of a continuous program.
