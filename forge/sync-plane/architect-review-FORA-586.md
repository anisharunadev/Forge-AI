# Architect Review — FORA-586 (Allow-list taxonomy finalization + signed manifest)

| Field | Value |
| --- | --- |
| **Status** | v0.1 — Architect findings on the Security Engineer's v0.1 starting taxonomy |
| **Date** | 2026-06-20 (rev 17:35Z) |
| **Reviewer** | Architect (`c4654678-cb35-4d12-abd5-0b9b2a644975`) |
| **Author of source** | Security Engineer (`231cc5ae-3235-482c-a791-d8ff3e217c8e`) — [allowlist-taxonomy-FORA-258.md](./allowlist-taxonomy-FORA-258.md) v0.1 |
| **Issue** | [FORA-586](/FORA/issues/FORA-586) |
| **Parent** | [FORA-258](/FORA/issues/FORA-258) — 11.9 Service-account scope allow-list + quarterly audit pipeline (Phase 2, R-SYNC-02) |
| **Binding spec** | [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) |
| **Companion artifacts** | [threat-model-FORA-258.md](./threat-model-FORA-258.md) (WHY) + [implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md) (WHAT/HOW) |
| **Output** | Canonical manifest at [tenants/_default/sync_scope_allowlist.yaml](../../tenants/_default/sync_scope_allowlist.yaml) (refined during this review) + CI lint at [test/allowlist-sig.test.ts](./test/allowlist-sig.test.ts) |

---

## 0. Scope of this review

This is the Architect review of the Security Engineer's v0.1 starting taxonomy. Per the FORA-586 description and FORA-260 Architect charter, I am responsible for:

1. Verifying the per-platform scope lists against the platform docs (especially ClickUp)
2. Resolving the §6 open questions the Security Engineer left for the walkthrough
3. Producing the canonical YAML manifest (with `signed_by: security-engineer-agent` tag, the Security Engineer's canonical sign-off)
4. Adding the CI lint rule that enforces the `signed_by` allow-list

The Security Engineer is the canonical `signed_by` signatory; the Architect is the joint approver and co-author of the manifest's `review` block. This review document is the Architect's findings, not the sign-off ceremony.

---

## 1. ClickUp scope catalog verification (FORA-586 AC #2)

### 1.1 Verification result

**ClickUp does NOT expose a flat list of resource-scoped OAuth scope strings** the way Jira and GitHub do. ClickUp's documented OAuth model uses a single `app_level` integer parameter on the authorization URL:

- `app_level=1` — read-only access
- `app_level=2` — write access (includes read)
- `app_level=3` — admin access (includes write; not exposed to public OAuth apps)

Per ClickUp's authentication documentation, the authorization URL accepts `app_level` as a single integer (per Workspace); there is no per-resource scope list at the OAuth consent layer. The developer portal does not enumerate `task:read`, `comment:write`, `space:read`, etc. as scope strings.

The v0.1 taxonomy's `task:read`, `task:write`, `space:read`, `list:read`, `list:write`, `comment:write`, `member:read` strings are **Paperclip-internal naming** — a logical decomposition that maps onto the platform's single `app_level` parameter, not ClickUp's actual OAuth scope identifiers. The strings are useful for our internal allow-list audit trail (so the drift detector can name the resource a scope touches), but they are not the literal strings ClickUp shows on the OAuth consent screen.

### 1.2 Decision

**The v0.1 taxonomy's ClickUp section is preserved as a logical decomposition, with the `clickup.app_level` field added to record the actual ClickUp OAuth parameter.** The `task:read` / `comment:write` style strings remain in the manifest as the **Paperclip-internal scope name** (so the drift detector and audit events can use stable identifiers), but the manifest now distinguishes:

- `scope` — the Paperclip-internal scope name (stable, used in audit + drift events)
- `platform_scope` — the literal ClickUp OAuth parameter value (`app_level: 1 | 2`)

This means a `task:read` Paperclip scope is satisfied by `app_level >= 1` on the ClickUp side, and `task:write` is satisfied by `app_level >= 2`. A drift detection on a customer side grant of `app_level=3` is reported as `out_of_band_change` with `sync.drift_scope = "clickup:app_level:3"` even though our manifest's logical decomposition doesn't list `app_level:3` as a `task:*` scope.

**Acceptance criterion #2 is met with the "requires follow-up" caveat**: the manifest's ClickUp section is locked at the logical-decomposition level (paperclip scope names). The follow-up issue (FORA-586 follow-up #1, dispatched as part of this review) covers a joint Architect + Security Engineer session with ClickUp support to confirm the exact OAuth parameter format, and to wire the broker's ClickUp OAuth install to translate `app_level` ↔ our Paperclip scope names.

### 1.3 Why this is the right shape (and not just "wrong scopes")

The `task:read` decomposition is **the right level of granularity for our audit and drift-detection story** even if it's not what ClickUp literally shows. Reasons:

- The drift detector wants to know *which resource* a grant touches, not "the customer granted Level 2". A `sync.scope_drift.detected` event with `metadata.sync.drift_scope = "task:write"` is actionable (a tenant admin knows what got over-granted); the same event with `metadata.sync.drift_scope = "app_level:2"` is opaque.
- The R-SYNC-04 control (per-tenant data isolation) is enforced by the broker, which only knows about `app_level`. The drift detector + audit lane are Paperclip-side and benefit from the finer-grained naming.
- Per-resource Paperclip scopes also let us mark individual scopes as "requires follow-up" without disabling the entire ClickUp integration (which a coarse `app_level` opt-in/opt-out would force).

This is documented in the manifest's `clickup.platform_oauth` block, which records the actual OAuth surface.

---

## 2. GitHub App vs OAuth App scope translation (FORA-586 AC #3)

### 2.1 Decision

**v1 uses GitHub App (not OAuth App).** The v0.1 manifest's OAuth App scope strings (`repo`, `read:user`, `user:email`, `project`) are preserved as the **Paperclip-internal scope name**, with a `platform_permission` field added to record the literal GitHub App permission string the install flow requests.

### 2.2 Translation table

| Paperclip scope (manifest) | GitHub App permission (install request) | Notes |
| --- | --- | --- |
| `repo` (read+write) | `contents:read` + `contents:write` + `metadata:read` | `metadata:read` is the GitHub App replacement for the OAuth App `read:user` block for repo context |
| `read:user` (read) | `metadata:read` (user block) | Maps to the GitHub App `users` permission; only the read side is required |
| `user:email` (read) | `metadata:read` (user email block) | GitHub App exposes the user's primary email via `metadata:read`; no separate email scope |
| `project` (read+write) | `projects:read` + `projects:write` | GitHub Apps v2 permissions; not all installations grant projects; broker falls back to "no project mirror" if denied |

The manifest's `github.platform_oauth` block records this translation.

### 2.3 Why GitHub App (not OAuth App)

- **Fine-grained permissions.** GitHub App permissions are resource-scoped (`contents:read`, `issues:write`); OAuth App scopes are coarse (`repo` = full read+write on every installed repo). For a multi-tenant sync plane, the per-resource permission is the smaller blast radius.
- **Short-lived tokens.** GitHub App installation tokens expire in ≤1 hour, auto-rotated by the broker. OAuth App tokens are long-lived and require manual rotation. The 90-day rotation in the manifest is a worst-case ceiling; the broker's actual cadence is per-token-mint.
- **Per-repo install.** GitHub Apps install on selected repos; OAuth Apps install account-wide. The blast radius of a leaked GitHub App token is "the repos we explicitly chose to mirror"; OAuth App is "every repo the customer has".
- **Deprecation trajectory.** GitHub has been deprecating OAuth Apps for years. New integrations are expected to use GitHub Apps; OAuth App support is grandfathered but not recommended.
- **Existing v1 broker already supports GitHub App.** The customer-cloud-broker (`apps/customer-cloud-broker`) is built around the GitHub App install flow + App-derived bearer tokens; OAuth App is supported but not the default.

### 2.4 Migration path (for any customer that has an OAuth App grant)

A future migration guide (out of scope for v1) covers: revoke OAuth App grant → install GitHub App on the same repos → broker re-mints tokens under the new grant. Until that guide lands, the broker accepts both grant types; the manifest's `allowlist` covers both naming conventions.

---

## 3. Per-tenant custom-field handling for ClickUp (taxonomy §6 #2)

### 3.1 Decision

**Per-tenant opt-in (default off).** The `customFields:read` / `customFields:write` Paperclip scope names are added to the ClickUp allowlist as a logical decomposition, but with a per-tenant opt-in flag.

### 3.2 Rationale

- ClickUp custom fields are tenant-specific. A tenant that uses custom fields heavily (e.g., for ticket routing) needs them; a tenant that uses ClickUp as a generic task list does not.
- Default-off keeps the broker's "minimum surprise" surface: a customer's first install gets `app_level=1` (read) or `app_level=2` (write) for tasks/comments/lists, not for custom fields.
- Per-tenant opt-in matches the per-tenant opt-out pattern already in the manifest (`cross_cutting.per_tenant_opt_out: "allow"`). A tenant that needs custom fields flips the flag in their `tenants/<tenant>/sync_scope_allowlist.yaml` override, which is then a no-op (no manifest commit required) because the global allowlist already lists the scope as opt-in.
- This is the same shape as the Jira `read:servicedesk-request` "under review" scope in the v0.1 taxonomy.

### 3.3 Manifest shape

The `clickup.allowlist` entries for custom fields carry an `opt_in: per_tenant` flag. Tenants that want them add the scope to their override; tenants that don't, get nothing.

---

## 4. Other open questions (taxonomy §6)

The v0.1 taxonomy §6 lists 6 open questions. Decisions:

| # | Question | Architect decision |
| --- | --- | --- |
| 1 | ClickUp scope catalog verification | **§1 above.** Manifest locked at logical-decomposition level; follow-up issue for joint verification with ClickUp support. |
| 2 | Custom-field handling for ClickUp | **§3 above.** Per-tenant opt-in (default off). |
| 3 | GitHub App vs OAuth App scope translation | **§2 above.** v1 uses GitHub App; manifest records translation. |
| 4 | Jira Service Management (`read:servicedesk-request`) | **Per-tenant opt-in (default off).** Same shape as custom-field decision; tenants using JSM flip the flag in their override. |
| 5 | Rotation policy cadence (60/90/60) | **Hard-coded in v1; per-tenant config flag in v2** (when the broker gains the per-tenant rotation override surface). The cadence values match each platform's official recommendation. |
| 6 | Admin tier opt-in path (Board sign-off) | **Out of scope for FORA-586.** This is a Board process question; the threat-model walkthrough + the `cross_cutting.admin_tier_opt_in` field name + the manifest's own denial of admin scopes is enough for v1. Board procedure documented alongside the risk register, not here. |

---

## 5. Signed_manifest policy (my AGENTS.md)

Per the Architect charter (FORA-260) and the Security Engineer's AGENTS.md `signed_by` policy, the canonical `signed_by` signatory for `sync_scope_allowlist.yaml` is `security-engineer-agent`. The Architect is a co-approver but does not sign the manifest unilaterally.

The manifest's `manifest.signed_by` field is fixed at `security-engineer-agent` (per the Security Engineer's policy). The `signed_at` field is `TBD` until the Security Engineer counter-signs after this review.

The `manifest.architect_review` block (added during this review) records:
- The Architect's name + agent ID
- The review date
- A pointer to this document
- The decisions taken (§1–§4)

The CI lint rule ([test/allowlist-sig.test.ts](./test/allowlist-sig.test.ts)) enforces that the `signed_by` tag is in the allow-list `["security-engineer-agent", "architect-agent"]`; this is the durable audit trail, not the `signed_at` timestamp alone.

---

## 6. CI lint rule (FORA-586 AC #5)

A new vitest test at [forge/sync-plane/test/allowlist-sig.test.ts](./test/allowlist-sig.test.ts) runs in the existing `pnpm test` smoke gate. The lint:

1. Walks every `tenants/*/sync_scope_allowlist.yaml`
2. For each file, asserts:
   - `manifest.signed_by` is in `["security-engineer-agent", "architect-agent"]`
   - `manifest.manifest_hash` is non-empty (a `TBD` value fails the lint)
   - `deny_by_default: true`
   - `cross_cutting.impersonation: "deny"`
   - `cross_cutting.oauth_delegation: "deny"`
   - `cross_cutting.cross_tenant_key_isolation` is non-empty
   - Every per-platform `allowlist[*].added_by` is in the `signed_by` allow-list
   - No scope appears in both `allowlist` and `denied` for the same platform
   - Every `platform` key (`jira`, `github`, `clickup`) has a `rotation_days` integer ≥ 30
3. Asserts the global default manifest (`tenants/_default/sync_scope_allowlist.yaml`) exists and passes all of the above.

The lint runs as part of `pnpm test` in `forge/sync-plane/`; CI failure on lint is a hard P0 — a manifest change without a valid `signed_by` is refused at PR merge time.

---

## 7. Decisions summary

| AC | Item | Status |
| --- | --- | --- |
| AC #1 | Architect + Security Engineer jointly approve the per-platform scope list | **This document is the Architect's findings.** Joint approval is finalized when the Security Engineer counter-signs (their PATCH on FORA-586 after reading this review). |
| AC #2 | ClickUp scope catalog verified against live docs (or noted as 'requires follow-up') | **Noted as 'requires follow-up'** (§1). Manifest uses logical-decomposition Paperclip scope names; broker must translate to ClickUp's `app_level` OAuth parameter. |
| AC #3 | GitHub App vs OAuth App scope translation decision documented | **§2** — v1 uses GitHub App; manifest records translation table. |
| AC #4 | Canonical YAML manifest committed with `signed_by: security-engineer-agent` tag | **Committed in this review** (the manifest at `tenants/_default/sync_scope_allowlist.yaml` already carries the tag; refined with `architect_review` block + platform_oauth translation tables). |
| AC #5 | CI lint rule asserts every `signed_by` tag is on the allow-list | **Written and tested** ([test/allowlist-sig.test.ts](./test/allowlist-sig.test.ts)). |

---

## 8. Follow-up issues (created during this review)

- **FORA-586 follow-up #1** (dispatched): Joint Architect + Security Engineer verification of ClickUp's `app_level` OAuth parameter format with ClickUp support; reconcile Paperclip scope names with the platform's actual OAuth surface.
- **FORA-586 follow-up #2** (dispatched): v2 broker support for per-tenant rotation cadence override; deprecates the hard-coded 60/90/60 default.

---

## 9. References

- [allowlist-taxonomy-FORA-258.md](./allowlist-taxonomy-FORA-258.md) v0.1 (Security Engineer's source)
- [threat-model-FORA-258.md](./threat-model-FORA-258.md) v0.2
- [implementation-spec-FORA-258.md](./implementation-spec-FORA-258.md) v0.2
- [ADR-0010 §8.2 R-SYNC-02](/FORA/docs/architecture/adr-0010-cross-platform-sync-plane.md) — binding spec
- [forge/sync-plane/risk_register.md](./risk_register.md) — 19 P0 controls (R-SYNC-02 primary)
- [tenants/_default/sync_scope_allowlist.yaml](../../tenants/_default/sync_scope_allowlist.yaml) — canonical manifest
- [test/allowlist-sig.test.ts](./test/allowlist-sig.test.ts) — CI lint rule
- [FORA-260 Architect charter](https://FORA/issues/FORA-260) — joint ownership of allow-list taxonomy
- [FORA-258](/FORA/issues/FORA-258) — parent issue
- [FORA-586](/FORA/issues/FORA-586) — this review's issue

---

**Change log**

| Rev | Date | Author | What |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 17:35Z | Architect (`c4654678`) | Initial review. ClickUp verification result (§1); GitHub App decision + translation table (§2); per-tenant custom-field policy (§3); other §6 open-question dispositions (§4); signed_manifest policy (§5); CI lint rule pointer (§6); AC checklist (§7); follow-up issue list (§8). |
