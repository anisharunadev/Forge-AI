# Template note — Forge AI MCP servers and what `@fora/mcp-slack` copies from

This package is the **first chat/IM MCP server** in the Forge AI priority-1 set. It is built by copy-from-template of `@fora/mcp-github` ([Forge AI-4](/Forge AI/issues/Forge AI-4), [template note](../github/docs/template-note.md)). The seven contract points in the GitHub template-note are mandatory and non-negotiable; this server preserves all of them.

## Servers that share this template

| Server | Priority | Status | Differences vs. github |
| --- | --- | --- | --- |
| `@fora/mcp-github` | P1 | shipped | n/a |
| `@fora/mcp-jira` | P1 | shipped | **Project-pinned** (one level deeper than org-pin): `JIRA_PROJECT_KEY` + email + API token auth against Atlassian Cloud REST v3; `list_issues` / `search_jql` / `get_issue` / `create_issue` / `add_comment` / `transition_issue`; no `pull_request`/`repo` analogues; ADF in/out for description and comments. |
| `@fora/mcp-confluence` | P1 | shipped | Space-pinned (not org-pinned); `page_id` not `repo`; uses Confluence storage format (not GFM); Basic auth header built from email + API token; resolves `CONFLUENCE_SPACE_KEY` to a numeric space id on startup. |
| `@fora/mcp-slack` | P1 | shipped (this issue) | **Workspace-pinned** (Slack `team_id`): `SLACK_TEAM_ID` + `SLACK_BOT_TOKEN`; chat surface (channels, threads, messages, reactions) instead of repo/PR surface. No Slack SDK — direct `fetch` calls to `slack.com/api` mirror the Jira server's SDK-free stance. `post_message` and `update_message` require `confirm: true` as a human-in-the-loop gate (Forge AI-5 §5.2). |

Zendesk, Databricks, Azure DevOps, and **Microsoft Teams** are P2 and will follow the same template, but the four P1 servers get the contract first because they are the ones every design partner asks for.

## Contract drift vs. the github template

The Slack server is a faithful copy-from-template of `@fora/mcp-github` for the seven contract points:

1. **Single-scope pin on startup** — `SLACK_TEAM_ID` is required and asserted on startup via `auth.test`. The startup call is eager (in `index.ts` `main()`), so a wrong-workspace token fails fast at boot rather than on the first user call.
2. **Typed client wrapper** — `createClient(config)` returns a `Client` interface whose methods take IDs and primitives, never raw HTTP.
3. **Zod raw shapes as the source of truth** — same pattern as github/jira.
4. **Stdout = JSON-RPC, stderr = logs** — same.
5. **Smoke test pattern: mock HTTP + spawn server + drive via MCP client** — same. See `test/smoke.mjs` and `test/mock-slack.mjs`.
6. **Clean shutdown on SIGINT/SIGTERM** — same.
7. **No agent-visible env vars beyond the pin and the token** — same. The optional `SLACK_API_BASE_URL` is for smoke tests only and is documented as such; the model never sees it.

### Differences that are NOT contract drift

- **Per-call channel scope check** — Slack channels are workspace-scoped at the API level (a token only sees channels in its own workspace), so we additionally call `conversations.info` on every channel id and verify the channel's `team` matches the pin. This is the same safety property github's `assertOrg` and jira's `assertJqlScope` provide — the implementation differs because Slack's model is different, but the property is identical. Per-call `conversations.info` results are cached in-process keyed by channel id so the second tool call against the same channel doesn't re-hit Slack.
- **`confirm: true` requirement on writes** — `post_message` and `update_message` require an explicit `confirm: true` Zod literal. This is the human-in-the-loop gate for a destructive, externally-visible action (a message will land in a real Slack channel). It is a separate concern from the seven contract points, anchored in Forge AI-5 §5.2 prompt-injection defense, and applies to any server that writes to an external surface.
- **No SDK dependency** — Slack's Web API is stable enough to call directly with `fetch`, mirroring the jira server. The slack package therefore has the same two-runtime-deps as jira: `@modelcontextprotocol/sdk` and `zod`. The github server carries `@octokit/rest` because GitHub's REST surface is large enough that an SDK earns its keep; Slack's is small enough that it does not.
- **DMs are out of scope** — the agent surface only exposes channels, never DMs. The `list_channels` default `types=public_channel,private_channel` and the `channel` arg's docstring both make this explicit.

## Why Teams is a follow-up ticket, not this one

The original [Forge AI-93](/Forge AI/issues/Forge AI-93) ticket called for a unified `@fora/mcp-chat` package with a Slack-vs-Teams adapter that switches based on which token is set. After review in the Forge AI-25 redistribution, Teams was split out as a separate ticket (P2) so Slack could ship on its own with the contract's seven points preserved exactly. The Teams server will follow this same template; the only contract difference is `TEAMS_ACCESS_TOKEN` + `TEAMS_TENANT_ID` instead of `SLACK_BOT_TOKEN` + `SLACK_TEAM_ID`, and the Graph API call surface instead of the Slack Web API. The shared `@fora/mcp-chat` adapter idea is shelved — two narrow servers beat one dual-mode one for a security-sensitive boundary.

## Acceptance bar (also the template's)

A new MCP server is done when:

- All required tools are registered with Zod raw shapes and a one-line description per tool.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all N tools smoke-tested green`.
- README follows the same sections as the github one: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- `docs/template-note.md` is updated to list the new server and any contract drift it requires (this file).
- A `request_review` comment on the implementation issue links the smoke transcript and lists the manual verification step (e.g. "with a real Slack bot token, `list_channels` against the test workspace returns 2 channels and `post_message` lands in `#general` with `confirm: true` set").

Anything less is a draft.
