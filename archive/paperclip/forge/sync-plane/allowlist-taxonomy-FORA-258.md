# Allow-list Taxonomy — FORA-258 (R-SYNC-02)

| Field | Value |
| --- | --- |
| **Status** | v0.1 — **DRAFT, starting taxonomy for Architect review + CTO walkthrough** |
| **Date** | 2026-06-20 |
| **Author** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) |
| **Reviewer (joint owner)** | Architect (FORA-260 hire, `c4654678`) — per FORA-258 v0.2 impl spec §5 + §6 #1 |
| **Issue** | [FORA-258](/FORA/issues/FORA-258) |
| **Parent** | [FORA-249 Epic 11 — Forge Integration Layer](/FORA/issues/FORA-249) sub-task #9 (Phase 2) |
| **Binding spec** | [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) |
| **Companion specs** | [threat-model-FORA-258.md](./threat-model-FORA-258.md) + [implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md) |

---

## 0. Why this document exists

The FORA-258 v0.2 implementation spec §1 proposes a per-platform scope taxonomy module under `src/allowlist/taxonomy/{jira,github,clickup}.ts`. This document is the **starting content** for those taxonomy files — the actual OAuth scope names per platform, classified by tier, with per-scope justification. The Architect reviews and iterates; the Security Engineer holds the `signed_by` tag for the canonical version.

**Tiers:**
- `read` — required for sync plane reads (mirror updates, polling, audit reconciliation)
- `write` — required for sync plane writes (mirror comments, status updates)
- `admin` — **DENIED by default** in v1; can be added per-scope with explicit Board sign-off

**Deny-by-default rule:** any scope not in this allow-list is refused at OAuth install time. The customer-side tenant admin sees a banner listing the requested scopes and must consent to each. Scopes outside the allow-list are reported as "denied by Sync Plane policy" with an `auth.scope.denied` audit event.

---

## 1. Jira scopes

Jira Cloud OAuth 2.0 (3LO) classic scopes per [Atlassian OAuth 2.0 docs](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/). Tenant admin grants `paperclip-sync-plane-jira-{tenant}` synthetic service account at install time.

### 1.1 Required (`read` + `write` only)

| Scope | Tier | Justification | Enables |
| --- | --- | --- | --- |
| `read:jira-work` | read | Required to read issues, comments, attachments, statuses on customer Jira | Inbound webhook receiver + polling backstop (FORA-257) + mirror reconciliation |
| `read:jira-user` | read | Required to map customer-side human commenters to Paperclip actors | Author attribution per R-SYNC-04 + ADR-0010 §5 |
| `read:project-scope` (or `read:board-scope` for software boards) | read | Required to read project metadata for canonical mapping table (ADR-0010 §3.1) | Per-project mirror configuration |
| `write:jira-work` | write | Required to write comments, issue updates, status transitions on customer Jira | Outbound mirror writes (every_event default per Board 2026-06-17) |
| `write:issue.createmeta` (sometimes `write:issue`) | write | Required to create new issues on customer Jira when Paperclip-side escalates | Outbound issue creation in board-response runs |
| `write:comment.createmeta` (sometimes `write:comment`) | write | Required to post comments on customer Jira from Paperclip agents | Outbound comment mirror per ADR-0010 §6 canonical envelope |
| `write:attachment` (sometimes `read:attachment`) | write | Optional — for binary attachment sync. **Out of scope for v1** per ADR-0010 §11. Explicitly NOT in v1 allow-list. | (None in v1; deferred) |

### 1.2 Denied (admin tier)

| Scope | Tier | Why denied |
| --- | --- | --- |
| `manage:jira-project` | admin | Not needed for sync plane; high-blast-radius if compromised. |
| `manage:jira-configuration` | admin | Schema-modifying; never required for read/write mirror. |
| `admin:jira` (sometimes `admin:jira-project` or `admin:jira-software`) | admin | Same — high-blast-radius. |
| `delete:jira-work` | admin | Sync plane never deletes; we tombstone (ADR-0010 §6.1 `deleted_hlc`). |

### 1.3 Scopes under review (for v2 — not in v1 allow-list)

| Scope | Tier | Why under review | Decision owner |
| --- | --- | --- | --- |
| `read:audit-log` | read | Could enhance outbound detection of in-platform scope changes; not strictly required for v1 | Architect + Security Engineer |
| `read:servicedesk-request` | read | Required only if tenant uses Jira Service Management (not all do) | Tenant config flag |
| `read:field-configuration` | read | Could support per-tenant field mapping; not in v1 schema | Architect |

---

## 2. GitHub scopes

GitHub App / OAuth scopes per [GitHub OAuth scopes docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps). Tenant admin grants `paperclip-sync-plane-github-{tenant}` GitHub App installation at install time.

### 2.1 Required (`read` + `write` only)

| Scope | Tier | Justification | Enables |
| --- | --- | --- | --- |
| `repo` (full read+write on installed repos) | read+write | Required to read issues, comments, labels, milestones + write comments, issue updates | All GitHub-side sync plane operations |
| `read:user` | read | Required to map GitHub user → Paperclip actor for author attribution | R-SYNC-04 + ADR-0010 §5 |
| `user:email` | read | Required for `git commit` author email mapping (used by some integration flows) | Outbound commit metadata |
| `project` | read+write | Required to read + update GitHub Projects v2 status | Mirror state to GitHub Projects (per ADR-0010 §3.2 field mapping) |

### 2.2 Denied (admin tier)

| Scope | Tier | Why denied |
| --- | --- | --- |
| `admin:org` | admin | Org-level settings; never required. Org-admin scope is a single-token-takeover vector per SOC 2 CC6.1. |
| `admin:repo_hook` | admin | Sync plane does not install webhooks from its own service account; webhooks are installed by the GitHub App definition. |
| `admin:org_hook` | admin | Same as above. |
| `delete_repo` | admin | Sync plane never deletes; tombstones via issue close. |
| `admin:user` / `admin:user:email` | admin | User-level admin; never required. |
| `admin:enterprise` | admin | Enterprise admin; never required. |
| `admin:gpg_key` / `admin:ssh_signing_key` | admin | GPG/SSH key admin; never required. |
| `admin:public_key` | admin | Public key admin; never required. |
| `admin:invitation` | admin | Org invitation admin; never required. |
| `admin:enterprise_hook` / `admin:org_member` | admin | Membership admin; never required. |
| `admin:business_portfolio` / `admin:licenses` | admin | Enterprise license admin; never required. |
| `admin:user_block` | admin | User-blocking admin; never required. |

### 2.3 Scopes under review (for v2 — not in v1 allow-list)

| Scope | Tier | Why under review | Decision owner |
| --- | --- | --- | --- |
| `workflow` | write | Required to update GitHub Actions workflow files; not in v1 mirror scope. | Architect + Security Engineer |
| `write:packages` | write | Package registry writes; out of scope. | (No — never required) |
| `codespace` / `admin:codespaces` | write / admin | Codespace access; never required for sync. | (No) |
| `notifications` | read | Could enhance inbound event detection; not strictly required. | Architect |

---

## 3. ClickUp scopes

ClickUp API token scopes per [ClickUp API docs](https://clickup.com/api). ClickUp uses API tokens + per-space OAuth scopes; the model is less standardized than Jira/GitHub. Tenant admin grants `paperclip-sync-plane-clickup-{tenant}` service account at install time.

### 3.1 Required (`read` + `write` only)

| Scope | Tier | Justification | Enables |
| --- | --- | --- | --- |
| `task:read` | read | Read tasks, comments, attachments, statuses | Inbound webhook receiver + polling backstop |
| `task:write` | write | Update tasks, post comments, change status | Outbound mirror writes |
| `space:read` | read | Read space + list metadata for canonical mapping table | Per-space mirror configuration |
| `list:read` | read | Read list metadata for canonical mapping table | Per-list mirror configuration |
| `list:write` | write | Create + update lists if Paperclip escalates | Outbound list creation in board-response runs |
| `comment:write` | write | Post comments on customer ClickUp from Paperclip agents | Outbound comment mirror |
| `member:read` | read | Map ClickUp user → Paperclip actor for author attribution | R-SYNC-04 + ADR-0010 §5 |

### 3.2 Denied (admin tier)

| Scope | Tier | Why denied |
| --- | --- | --- |
| `space:write` (admin) | admin | Space-level configuration; never required. |
| `user:write` | admin | User management; never required. |
| `webhook:write` (admin) | admin | Webhook installation; the platform install-time setup grants webhooks via a separate surface. |
| `goal:write` (admin) | admin | Goal CRUD; out of scope for sync. |
| `view:write` (admin) | admin | View management; out of scope. |
| `folder:write` (admin) | admin | Folder management; out of scope. |

### 3.3 Under review (ClickUp scope catalog is less standardized — needs Architect verification)

| Scope | Tier | Why under review | Decision owner |
| --- | --- | --- | --- |
| `timeTracking:read` | read | Could enhance task metadata; not in v1 mirror. | Architect + Security Engineer |
| `customFields:read` / `customFields:write` | read / write | ClickUp has heavy custom-field usage; mapping may require these. Tenant-configurable. | Architect (depends on `forge/sync-plane/mapping_clickup.json`) |
| `checklist:write` | write | Could mirror checklist state; not in v1 ACs. | (No for v1) |

---

## 4. Cross-cutting decisions

### 4.1 Admin tier: denied by default across all platforms

The `admin` tier is **excluded by default** in v1 across Jira, GitHub, and ClickUp. To add any admin scope, the change must:
1. Be proposed in this taxonomy document with a justification entry
2. Be reviewed by Architect + Security Engineer
3. Be signed by `signed_by: security-engineer-agent` in the YAML manifest
4. Be approved by a separate Board `ask_user_questions` interaction (per Board policy on high-blast-radius scopes)

**Why:** Admin-tier scopes on a single synthetic service account = single-token-takeover vector. A leak of one admin-scope service-account token = customer-side org/jira/clickup-wide compromise. The security posture (failure-closed) treats admin scopes as a separate opt-in.

### 4.2 Outbound-only by default

The service account writes to the customer side. It does **not** impersonate customer users, does not delegate via OAuth, and does not grant Paperclip agents human-user identities. Per ADR-0010 §5: "No impersonation, ever. Service accounts are provisioned by the tenant admin at install time and granted only the scopes listed in the Sync Plane config."

### 4.3 Per-tenant scoping

The allow-list is **per-tenant** with a global default. Tenants can opt out of specific scopes (e.g., a tenant that does not use ClickUp checklists opts out of `checklist:write`). Tenants cannot opt in to scopes not in the global allow-list (per-tenant opt-in to new scopes requires a new taxonomy entry + signed manifest).

### 4.4 Rotation policy

All service-account tokens (Jira / GitHub / ClickUp) live in `apps/customer-cloud-broker` vault (FORA-126) via AWS Secrets Manager (FORA-128). Rotation cadence:
- Jira: every 60 days (matches Atlassian recommendation for 3LO apps)
- GitHub: every 90 days (matches GitHub App installation token lifecycle)
- ClickUp: every 60 days (matches ClickUp personal access token best practice)

The `daily_audit_sample` (FORA-210) verifies every mirror event references a credential in the inventory and within its rotation window.

### 4.5 Cross-tenant key isolation

Per FORA-161 HMAC pattern + ADR-0010 R-SYNC-04 control: per-tenant webhook secret for the inbound scope-change notification (Jira / GitHub / ClickUp), signed with HMAC-SHA256, 5-min timestamp window + nonce to prevent replay. The webhook receiver rejects with 401 + `auth.login.failed reason: webhook_signature_mismatch` audit event on mismatch.

---

## 5. Mapping to spec pair

| Section | Threat model reference | Implementation spec reference |
| --- | --- | --- |
| Tier classification | §2.6 EoP "Tenant admin grants the platform-side service-account a scope outside the allow-list" | §1 package proposal `src/allowlist/taxonomy/` |
| Deny-by-default | §1 asset model + §2.6 T-1 + §2.2 T-2 | §3 event schema `metadata.sync.drift_kind = added_scope` |
| Outbound-only | §1 (no inbound impersonation) | §3 event schema `metadata.sync.actor_type = agent` |
| Per-tenant scoping | §1 (per-tenant webhook secrets) | §2 data model `sync_scope_allowlist` PK `(tenant_id, platform, scope_name)` |
| Rotation policy | §4 R-X1 (per-platform token storage) | §4 test strategy (memory-dump-scan property test) |
| Cross-tenant key isolation | §2.1 Spoofing T-1 | §3 event schema `metadata.sync.platform_credential_ref` |
| Admin tier denied | §2.6 EoP T-1 (admin-scope takeover) | (this taxonomy) §4.1 |

---

## 6. Open questions for the walkthrough

1. **ClickUp scope catalog verification**: ClickUp scopes are less standardized than Jira/GitHub. Architect should verify the exact scope names from the live ClickUp API docs before this taxonomy becomes the canonical version. (Acceptable to ship v0.1 with ClickUp sections marked "TBD Architect verification".)
2. **Custom field handling for ClickUp**: tenant-configurable custom-field scopes — is this per-tenant opt-in or per-platform global opt-in?
3. **GitHub App vs OAuth App**: GitHub Apps have a different scope model (repository-level install + permission grants). The v0.1 taxonomy assumes OAuth App scopes; the v1 implementation may need to translate to GitHub App permissions (`contents:write` = `repo` etc.). Architect + Security Engineer to decide.
4. **Jira Service Management (`read:servicedesk-request`)**: per-tenant opt-in or always-on? Affects the allow-list schema.
5. **Rotation policy cadence**: 60/90/60 days is a starting point. Should this be configurable per tenant, or hard-coded?
6. **Admin tier opt-in path**: when a tenant genuinely needs an admin scope, what's the Board sign-off process? This taxonomy is a P0 audit artifact; the Board sign-off procedure should be documented alongside the `signed_by` policy.

---

## 7. References

- [Atlassian OAuth 2.0 (3LO) scopes](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) — Jira scope reference
- [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) — GitHub scope reference
- [ClickUp API docs](https://clickup.com/api) — ClickUp scope reference (needs Architect verification)
- [FORA-126 customer-cloud-broker](/FORA/issues/FORA-126) — vault + audit pattern
- [FORA-128 secrets-mcp AWS SM adapter](/FORA/issues/FORA-128) — per-tenant secret storage
- [FORA-161 IdP Revoke Webhook](/FORA/issues/FORA-161) — HMAC-SHA256 per-tenant pattern (template)
- [FORA-204 sync-plane audit + risk register](/FORA/issues/FORA-204) — `metadata.sync.*` schema
- [FORA-210 daily audit sample](/FORA/issues/FORA-210) — daily verification path
- [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [forge/sync-plane/threat-model-FORA-258.md](./threat-model-FORA-258.md) — companion WHY
- [forge/sync-plane/implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md) — companion WHAT/HOW

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Security Engineer (`231cc5ae`) | Initial draft. Per-platform scope enumeration (Jira, GitHub, ClickUp) with tier classification + per-scope justification. 7 cross-cutting decisions (deny-by-default, admin-tier opt-in, outbound-only, per-tenant scoping, rotation policy, cross-tenant key isolation). 6 open questions for Architect + CTO walkthrough. |