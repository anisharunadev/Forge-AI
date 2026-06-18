# Jira Discovery — Sub-goal 1.4 (FORA-62)

**Generated:** 2026-06-17
**By:** `ba-agent` (99b34c5d-87d4-42a0-a66a-c65a916aeeec)
**Status:** **Blocking — needs CTO/board decision before Epic + 8 stories can be pushed.**

---

## 1. What I confirmed

| Check | Result | Source |
|---|---|---|
| Atlassian MCP reachable | yes — `https://neptunetriton.atlassian.net` | `mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources` |
| Scopes | `read:jira-work`, `write:jira-work`, Confluence read+write | same |
| FORA-61 board approval | `accepted` at 2026-06-17T16:28:04Z by `local-board` (interaction `ecee6f96-…`) | `GET /api/issues/FORA-61/interactions` |
| Approved Epic package | 8 stories, S1–S8; revision `1dd556f7-b3b4-4d19-92a8-3d2d0bda3327` | `GET /api/issues/FORA-61/documents` (key=`epic_package`) |
| Dependency graph | 11 edges; critical path `S1 → S2 → S4 → S5 → S6` (5 stories) | attachment `317fd462-…-dependency_graph.json` |
| Cost envelope | p50 $192K / p95 $320K; per-run p50 $0.47 / p95 $2.85 / hard ceiling $5.00 | attachment `20bde0e7-…-cost_estimate.json` |
| Risk register | 9 P0 controls routed to Security (Epic 5) | attachment `cf5e2996-…-risk_register.md` |
| Q1 (trigger scope) resolution | "Self-bootstrapping dogfood — FORA is the product" | FORA-17 interaction `f79b7063-…` |
| Target Jira project | **UNRESOLVED** — see §2 | this heartbeat |
| Target sprint | **UNRESOLVED** — depends on project pick | this heartbeat |

## 2. The blocking ambiguity — no FORA project in the customer's Jira

The customer's Jira instance (`neptunetriton.atlassian.net`) is provisioned with **7 projects**, none of which is `FORA`:

| Project | Type | Has Epic + Story? | Last activity | Assessment for FORA-platform delivery |
|---|---|---|---|---|
| `AWS` | software | yes | unknown | **wrong domain** — AWS infra tickets, not platform features |
| `NEP` (Neptune Navigate) | software | yes | unknown | possible holding pen; mixes app + platform |
| `NGP` (Next Gen Player 2.0) | business | **no** Epic/Story | unknown | not usable for this Epic shape |
| `NN` (Neptune Now) | software | yes | unknown | possible holding pen; mixes app + platform |
| `NR` (Neptune Radio) | software | yes | unknown | possible holding pen; mixes app + platform |
| `VOY` (Voyager) | software | yes | **most active** (VOY-1011, -1148, -1178, -1765, -1999, -2043, -2121, -2139, -2295) | most defensible *existing* target; mixes FORA-platform work with Voyager-app work |
| `WR` (WCAG Readiness) | business | **no** Epic/Story | unknown | not usable for this Epic shape |
| **`FORA` (new)** | — | — | — | **matches convention** but requires admin permission we don't have |

### Why I won't silently pick a project

- The customer convention in `workspace/customer/conventions.md` §3 says Jira projects use `<CUSTOMER>-<NNN>`. With Q1 resolved as "FORA is the product" (dogfood), the customer is FORA — so the project should be `FORA`, not a Neptune app project.
- The Atlassian MCP scope is `write:jira-work` (issues, comments, links, sprints, boards). It does **not** include `manage:jira-project` — the agent cannot create a new project.
- "Use VOY because it's the most active" mixes FORA-platform delivery (8 stories on the Forge Ideation Agent) with Neptune's customer-facing Voyager app backlog. That contaminates VOY-2139's existing epic list, and breaks the audit trail of which work is internal platform vs. customer app.
- Per the agent operating posture, ambiguity is flagged fast via `ask_user_questions`, not invented.

## 3. The three reasonable resolution paths (for the CTO/board)

| # | Resolution | Pros | Cons | Unblock action |
|---|---|---|---|---|
| **A** | **Create a new `FORA` project** in `neptunetriton.atlassian.net` (admin action outside the agent) and have me push the 8 stories there | Matches `<CUSTOMER>-<NNN>` convention; clean separation from customer-app backlogs; reusable for every internal FORA-platform epic going forward | Adds 1 board day (admin action); needs a Jira admin with `manage:jira-project` | A Jira admin (currently nobody inside the agent team) creates the project with Epic + Story + Sub-task issuetypes and an active sprint; agent pushes the 8 stories |
| **B** | **Use `VOY` (Voyager)** as a temporary holding pen | No new admin step; project already has Epic/Story/Sub-task; most active project so most likely to be noticed | Mixes FORA-platform work with Voyager-app work; contaminates VOY-2139's epic namespace; sets a bad precedent | CTO confirms; agent pushes stories under the Epic with `Epic Link = Forge Ideation Agent` and labels `forge-platform`, `dogfood`, `epic-1` so the work is grep-able |
| **C** | **Park FORA-62 as `blocked`**, escalate via parent `FORA-17` for a board call | Most explicit; no risk of putting work in the wrong place | Delays the downstream stages (Architecture handoff, FORA-27); Epic 1 is "done" per the FORA-62 acceptance criteria | Board call on the parent epic; agent re-picks the issue on resolution |

## 4. What I will do once unblocked

Once the CTO/board picks a path, the agent executes the same way:

1. Resolve target project + active sprint via `mcp__plugin_atlassian_atlassian__getVisibleJiraProjects` (re-query) and the board's `/sprint` API.
2. Create the Epic in that project (issue type `Epic`) with the FORA-59 → FORA-60 → FORA-61 lineage as the description and the Paperclip links per the comment-style rule.
3. Create 8 stories (`S1`–`S8`) with the Given/When/Then AC + dependencies from `dependency_graph.json` as the description body and `parent` pointing at the Epic.
4. Add the 11 dependency edges via `createIssueLink` (inwardIssue = blocker, outwardIssue = blocked).
5. Apply labels per the issue body: `forge-ideation-agent`, `requirement-ingestion`, `epic-1`, `pm-source`.
6. Components: pick from the existing project component list once the project is selected; otherwise use the convention default `Platform / Forge / Ideation`.
7. Attach the `epic_package.md` to the Epic as a remote link (Confluence page or `forge/1.3/epic_package.md` URL).
8. Generate `jira_sync_report.md` (this file's successor) and attach it to FORA-62 + comment-link on FORA-17.

## 5. Audit

- Run: `3ae3d0d1-630e-4d38-a4ff-0f631b4b812b`
- Source issue: [FORA-62](/FORA/issues/FORA-62) — Sub-goal 1.4 — Jira sync
- Upstream approved Epic: [FORA-61](/FORA/issues/FORA-61) — Sub-goal 1.3 — Epic generator
- Parent Epic: [FORA-17](/FORA/issues/FORA-17) — Epic 1 — Forge Ideation Agent (currently `blocked`, assigned to CEO)
- Customer Jira instance: `https://neptunetriton.atlassian.net`
- Atlassian MCP: `cloudId=37e1df59-b7dc-4439-8f9c-eba94e504dac`, scopes `read:jira-work` + `write:jira-work`
