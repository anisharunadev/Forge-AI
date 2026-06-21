# Template note — which MCP servers `forge-ai/mcp-zendesk` templates for

This package is the **second P2 MCP server** in the Forge AI platform and copies the `forge-ai/mcp-github` template (Forge AI-4). The shared structure was designed up front so P2 servers can ship in days, not weeks, and the agent runtime can treat them uniformly.

## Servers that copy this template

| Server | Priority | Status | Differences vs. github |
| --- | --- | --- | --- |
| `forge-ai/mcp-github` | P1 | shipped | n/a |
| `forge-ai/mcp-jira` | P1 | shipped | Project-pinned (one level deeper than org-pin); ADF in/out for description and comments. |
| `forge-ai/mcp-confluence` | P1 | shipped | Space-pinned; Confluence storage format; Basic auth from email + API token. |
| `forge-ai/mcp-aws` | P1 | shipped | Account+region pinned; AWS SDK credential chain; JSON 1.1 protocol. |
| `forge-ai/mcp-sonarqube` | P1 | shipped | Project-pinned; `fetch` against SonarQube REST v1; no SDK. |
| `forge-ai/mcp-azure-devops` | P2 | shipped (Forge AI-96) | Project-pinned (org + project); `fetch` against AzDO REST 7.1; Basic auth from a project-scoped PAT. Three mutations require `confirm: true`. |
| `forge-ai/mcp-zendesk` | **P2** | **shipped (this issue, Forge AI-94)** | **Subdomain-pinned**: `ZENDESK_SUBDOMAIN` + `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`; Basic auth from a Zendesk API token; `fetch` against Zendesk REST v2; no SDK. Two mutations require `confirm: true` (`create_ticket`, `update_ticket`); `add_comment` and `apply_macro` are append-only / reviewable and do not require explicit confirmation. The auth header is `Basic base64("{email}/token:{apiToken}")` — the `/token` suffix is Zendesk-specific. List endpoints use page+perPage pagination; search uses Zendesk's native search syntax. |

Databricks is still P2 and will follow the same template.

## The shared contract

This server implements the seven Forge AI MCP contract points verbatim:

1. **Single-scope pin on startup.** The server refuses to start without `ZENDESK_SUBDOMAIN` + `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`. The subdomain is the unit of safety — one Zendesk instance per server. The model never sees the pin.
2. **Typed client wrapper.** A single `createClient(config)` returns a `Client` interface whose methods take only IDs and primitives, never raw HTTP or raw URLs.
3. **Zod raw shapes as the source of truth.** Each tool definition carries a Zod raw shape (e.g. `{ ticketId: z.number().int().positive() }`) which is fed to `McpServer.tool()` and also used to validate runtime input. No JSON Schemas, no manual conversion.
4. **Stdout = JSON-RPC, stderr = logs.** No human-readable log lines on stdout — they would corrupt the protocol stream.
5. **Mock-HTTP smoke test.** `test/smoke.mjs` boots a local mock of the upstream HTTP API, spawns the compiled server with `ZENDESK_API_BASE_URL` pointed at the mock, drives every tool over the MCP SDK `Client`, and asserts both the returned payload AND that the right HTTP routes were hit.
6. **Clean shutdown on SIGINT/SIGTERM.** An enterprise agent runtime will restart MCP servers; a server that hangs on shutdown blocks that. Signal handlers close the transport and `process.exit(0)`.
7. **No agent-visible env vars beyond the pin and the token.** All knobs the model could legitimately set are exposed as tool arguments with Zod defaults (e.g. `page`, `perPage`, `priority`, `status`, `tags`, `public`). The smoke test override `ZENDESK_API_BASE_URL` is the only extra env var, and it is documented as smoke-test-only.

## Contract drift vs. the GitHub template

| # | Where | Drift | Rationale |
| --- | --- | --- | --- |
| 1 | `src/client.ts` | Uses plain `fetch` (no SDK); Zendesk has no first-party TypeScript SDK we want to depend on. | The Zendesk REST v2 surface we touch is small and stable; `fetch` keeps the dep tree minimal. |
| 2 | `src/tools.ts` | Two mutations carry a `confirm: z.literal(true)` Zod arg (`create_ticket`, `update_ticket`). | The platform bar for `confirm: true` is: any tool that has a meaningful destructive side-effect on the customer data plane must require explicit intent. Ticket creation and full-ticket updates qualify; appending a comment and applying a macro (which the human reviews in the Zendesk UI) do not. |
| 3 | `src/config.ts` | Auth uses Zendesk API token sent as Basic auth `base64("{email}/token:{apiToken}")`. The `/token` suffix is Zendesk-specific. | Matches the Zendesk REST v2 contract; mirrors the Confluence pattern (email + API token as Basic auth) with a tighter scope: the agent's role must be a custom role with read + comment + create-ticket scopes only. |
| 4 | `src/client.ts` | `add_comment` and `apply_macro` use the same PUT `/api/v2/tickets/{id}.json` shape Zendesk expects. | The Zendesk REST v2 contract uses the ticket update endpoint for comment appends; `apply_macro` is a separate POST endpoint that returns the updated ticket. |
| 5 | `src/client.ts` | Search uses `GET /api/v2/search.json?query=…` with Zendesk's native query syntax (type:ticket, tags:foo, status:open, etc.). | The model can express rich filters without us re-implementing a query parser. |
| 6 | `test/mock-zendesk.mjs` | The auth header is asserted by reconstructing `base64("{email}/token:{apiToken}")` and matching the recorded `authorization` exactly. | The mock-backed smoke proves the client emits the correct Basic auth shape — the same shape a real Zendesk instance expects. |
| 7 | `test/smoke.mjs` | Asserts `confirm: false` is rejected for `create_ticket` and that zero HTTP calls are made. | The Zod literal is the only thing standing between the model and a real Zendesk mutation; the smoke proves it works. |

## Acceptance bar (also the template's)

- All 8 required tools are registered with Zod raw shapes and one-line descriptions.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all 8 tools smoke-tested green`.
- README follows the same sections as the GitHub one: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- This `docs/template-note.md` is updated to list the new server and any contract drift it requires.
- A `request_review` comment on Forge AI-94 links the smoke transcript and names the manual verification step.

Anything less is a draft.
