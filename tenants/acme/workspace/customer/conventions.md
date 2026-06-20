# Customer Conventions

**Scope:** Naming, repo layout, and delivery norms at the customer level. Overrides the global defaults only where the customer contract requires it.
**Audience:** Every engineer and sub-agent delivering to a customer, and every customer's engineering counterpart.
**Stage injection:** Inject into **Developer**, **DevOps**, and **Documentation** sub-agents. Required when the work touches a customer-specific deliverable.

---

## 0. Quick start

- **Read [README §9](../README.md#9-quick-start-for-a-new-sub-agent) first.** That is your first ten minutes. This file is the customer-facing delivery bar; the README is how you walk in.
- **The convention hierarchy in §1 wins conflicts.** Customer contract > customer-specific override (`engagements/<customer-slug>/conventions.md`) > global convention (this file) > engineering memory. A deviation that is not in the override file is an unlogged exception and gets rejected in PR review.
- **A customer PR is not a regular PR.** The customer PR bar in §5 is stricter than the engineering PR bar in [memory/coding.md §10](../memory/coding.md#10-code-review-bar): customer name in the title, Jira link, verification evidence with a screenshot or log, and a security reviewer on isolation/audit/secrets changes.
- **Customer-pinned releases are a different release.** They follow the customer's change-management SLA (per §5), ship release notes 5 business days in advance, and are communicated in the customer's preferred channel — not Slack-only.

---

## 1. The convention hierarchy

Conventions are layered. The layer that wins is the most specific one that applies.

1. **Customer contract.** A signed MSA/SOW can override anything below it.
2. **Customer-specific conventions.** `engagements/<customer-slug>/conventions.md` (this file is the global default).
3. **Customer standards.** [customer/standards.md](./standards.md) (the inherited industry standards).
4. **Engineering memory.** [memory/coding.md](../memory/coding.md), [memory/architecture.md](../memory/architecture.md), [memory/devops.md](../memory/devops.md), [memory/security.md](../memory/security.md).
5. **Project tech stack.** [project/tech-stack.md](../project/tech-stack.md).

If two layers conflict, the higher layer wins. The conflict is logged in the PR description and, if it changes a one-way door, in an ADR (per [memory/architecture.md §5](../memory/architecture.md#5-adrs-architecture-decision-records)). The same term may mean different things across files — when in doubt, the [customer/glossary.md](./glossary.md) definition is the source of truth for customer-facing vocabulary.

## 2. Repo and workspace layout per customer

A customer engagement gets a sub-folder of the platform monorepo when the engagement is product work (touching the core platform). It gets a separate repo when the engagement is bespoke consulting or a one-off integration that does not belong in the core.

```
platform monorepo
└── engagements/
    └── <customer-slug>/
        ├── README.md                 # what this engagement is
        ├── conventions.md            # customer-specific overrides
        ├── integrations/             # MCP server configs, IAM roles, glue
        ├── runbooks/                 # customer-specific runbooks
        └── contracts/                # MSAs, DPAs, scope documents (links, not the docs themselves)
```

`<customer-slug>` is a kebab-case stable identifier. It is the same identifier in the billing code, the audit log, the metrics labels, and the URL of the customer admin console.

## 3. Naming conventions

| Surface | Default | Customer override | Example |
| --- | --- | --- | --- |
| Customer slug | `kebab-case` | n/a | `acme-corp` |
| Customer project in Jira | `<CUSTOMER>-<NNN>` | sometimes required by customer | `ACME-123` |
| Git branch | `<type>/<CUSTOMER>-<id>-<slug>` | sometimes required by customer | `feat/ACME-123-sso-integration` |
| PR title | `(<CUSTOMER>-<id>) <verb> <object>` | same | `(ACME-123) Wire SAML SSO into the Forge console` |
| Commit message | Conventional Commits | same | `feat(acme): wire SAML SSO into the Forge console` |
| Tag | `v<MAJOR>.<MINOR>.<PATCH>-<CUSTOMER>-<NNN>` | optional, only if customer-pinned | `v1.4.2-acme-7` |
| Tenant ID (internal) | `<customer-slug>` | n/a | `acme-corp` |
| MCP namespace | `mcp-<customer-slug>` | n/a | `mcp-acme-corp` |
| Secret in Secrets Manager | `fora/<env>/<customer-slug>/<purpose>` | n/a | `fora/prod/acme-corp/jira-api-token` |

A naming deviation that is not in the customer contract is rejected in PR review. We do not "just this once" exceptions on customer-facing surfaces.

## 4. Severity and priority matrices

### Severity (engineering triage)

| Level | Definition | Example |
| --- | --- | --- |
| **S0** | Customer data exposed or service down for all customers. | Tenant isolation breach; prod 5xx > 10 %. |
| **S1** | A customer-impacting bug with a workaround. | A specific integration is broken; the rest works. |
| **S2** | A bug without a workaround that is not customer-impacting yet. | A race condition in a non-hot path. |
| **S3** | A bug with a workaround and no customer impact. | A typo in an admin-only error message. |

A customer's severity matrix can be **stricter** (e.g., they call S1 what we call S2) but not looser. A loosening request is declined under [customer/standards.md §9](./standards.md#9-customer-extensions).

### Priority (roadmap ordering)

| Level | Definition | SLA to start |
| --- | --- | --- |
| **P0** | On the critical path of a customer commitment. | This sprint. |
| **P1** | Important, but not blocking a commitment. | Next sprint. |
| **P2** | Should do, no commitment. | This quarter. |
| **P3** | Nice to have. | Backlog. |

## 5. Delivery norms

### The PR bar (extends [memory/coding.md §10](../memory/coding.md#10-code-review-bar))

- A customer PR **must** name the customer in the title and the description.
- A customer PR **must** link the Jira ticket.
- A customer PR **must** include a verification step with concrete evidence (screenshot, log, command output, or repro recipe).
- A customer PR that touches tenant isolation, the audit log, or the secrets path **must** have a security reviewer.

### The release bar (extends [memory/devops.md §4](../memory/devops.md#4-deployment))

- A customer release is a tagged release; it ships through the release train.
- A customer release that is **customer-pinned** (a tag the customer will reference in their own change management) follows the customer's change-management SLA. We publish release notes 5 business days in advance.
- A customer release is communicated in the customer's preferred channel (email, Slack Connect, or customer portal).

### The incident bar (extends [memory/devops.md §7](../memory/devops.md#7-incident-response-the-play))

- A customer-impacting incident triggers a customer notification within 15 min (status page) and 60 min (named account contact).
- A P0 for one customer is a P0 for us. We do not "blame the customer" for a bug they hit first.

## 6. Communication norms

- **Tone:** direct, kind, never condescending. We are the expert; we do not perform expertise.
- **Channel:** async-first. The customer's preferred channel is the default; internal `#inc-<id>` is the war room.
- **Cadence:** weekly status by Friday 17:00 local to the customer. A missed status is a P2 process bug.
- **Docs:** the customer-facing doc is the contract. Internal jargon that does not appear in the customer's vocabulary is jargon we have not yet translated. When a term is contested, the [customer/glossary.md](./glossary.md) definition wins.

## 7. Customer-specific overrides (the override file)

When a customer's contract requires a deviation from these defaults, the deviation is captured in `engagements/<customer-slug>/conventions.md` and **only** in that file. The override file lists:

```markdown
# <Customer Name> — Conventions

- **Contract reference:** <link to the SOW / MSA section>
- **Approved by:** <name, role, date>
- **CTO sign-off:** <name, date>

## Overrides

| Default | Override | Reason | Contract clause |
| --- | --- | --- | --- |
| <what we change> | <what we do instead> | <why> | <link> |

## Additions

- <things the customer requires that are not in our defaults>

## Contact

- **Account contact:** <name, email, phone>
- **Escalation:** <name, role, contact>
- **Security contact:** <name, role, contact> (24/7 for P0/P1)
```

An override that loosens a security or audit default is rejected (per [customer/standards.md §9](./standards.md#9-customer-extensions)). The override file is reviewed quarterly by the CTO and the customer's named account contact; stale overrides are removed in the next release train.

## 8. Conventions anti-patterns (auto-flag in review)

- A customer-specific convention that lives outside `engagements/<customer-slug>/conventions.md`.
- A customer PR without a Jira link or a customer name.
- A customer release that is not announced in the customer's preferred channel.
- A "we'll just do it for this customer" exception that is not in the override file.
- A naming deviation that is not justified by the customer contract.
- A customer weekly status that slips more than 24 h past Friday 17:00 local.

## 9. Related

- The technical defaults that this overrides: [memory/coding.md](../memory/coding.md), [memory/architecture.md](../memory/architecture.md), [memory/security.md](../memory/security.md), [memory/devops.md](../memory/devops.md)
- The industry standards we inherit: [customer/standards.md](./standards.md)
- Customer-facing vocabulary and acronyms: [customer/glossary.md](./glossary.md)
- The product these conventions serve: [project/PRD.md](../project/PRD.md)

---

**Versioning:** this file ships through the normal release train (see [README §5](../README.md#5-versioning)). A change is a major version bump if it changes the convention hierarchy (§1), the override file format (§7), or the PR/release/incident bars in §5. A change that loosens the customer PR bar, the release announcement SLA, or the customer-pinned release contract is rejected. The CTO owns merges to this file.
