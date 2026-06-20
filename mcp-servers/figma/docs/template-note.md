# Template note — which MCP servers `@fora/mcp-github` templates for

This package is the **first concrete MCP server** in the Forge AI priority-1 set. The shared structure was designed up front so the rest of the priority-1 set — and the priority-2 Slack/Teams integration — can copy it and ship in days, not weeks.

## Servers that copy this template

| Server | Priority | Status | Differences vs. github |
| --- | --- | --- | --- |
| `@fora/mcp-github` | P1 | shipped (this issue) | n/a |
| `@fora/mcp-jira` | P1 | shipped | **Project-pinned** (one level deeper than org-pin): `JIRA_PROJECT_KEY` + email + API token auth against Atlassian Cloud REST v3; `list_issues` / `search_jql` / `get_issue` / `create_issue` / `add_comment` / `transition_issue`; no `pull_request`/`repo` analogues; ADF in/out for description and comments. |
| `@fora/mcp-confluence` | P1 | shipped | Space-pinned (not org-pinned); `page_id` not `repo`; uses Confluence storage format (not GFM); Basic auth header built from email + API token; resolves `CONFLUENCE_SPACE_KEY` to a numeric space id on startup. |
| `@fora/mcp-figma` | P1 | shipped | **File-pinned** (one level deeper than org-pin): `FIGMA_FILE_KEY` + `FIGMA_TEAM_ID` (asserted on startup) + `FIGMA_TOKEN` (PAT scoped to the team); read + comment-only — no design-file mutation; six tools (`get_file`, `get_file_nodes`, `get_node`, `get_images`, `get_comments`, `post_comment`); hand-rolled `fetch` client (no maintained TS SDK for the Figma REST v1 surface); `X-Figma-Token` header. See "Figma contract drift" below. |

Zendesk, Databricks, Azure DevOps, and Slack/Teams are P2 and will follow the same template, but the P1 servers get the contract first because they are the ones every design partner asks for.

## The shared contract

Every Forge AI MCP server has these properties. They are **not negotiable per-server** — that is what lets the orchestrator and agent runtime treat them uniformly.

1. **Single-scope pin on startup.** The server refuses to start without a pin env var (`GITHUB_ORG`, `JIRA_PROJECT_KEY`, `CONFLUENCE_SPACE_KEY`, `FIGMA_FILE_KEY` + `FIGMA_TEAM_ID`). The model can pass an ID, but it is asserted against the pin before any call lands. This is the safety property that lets us hand a customer a token and trust the agent won't escape into another customer's data.
2. **Typed client wrapper.** A single `createClient(config)` returns a `Client` interface whose methods take only IDs and primitives, never raw HTTP. Easier to mock, easier to audit, easier to swap to a different HTTP client later.
3. **Zod raw shapes as the source of truth.** Each tool definition carries a Zod raw shape (`{ owner: z.string(), repo: z.string(), ... }`) which is fed to `McpServer.tool()` and also used to validate runtime input. No JSON Schemas, no manual conversion.
4. **Stdout = JSON-RPC, stderr = logs.** No human-readable log lines on stdout — they would corrupt the protocol stream. Everything operational goes to stderr.
5. **Smoke test pattern: mock HTTP + spawn server + drive via MCP client.** Each server ships a `test/smoke.mjs` that:
   - boots a local mock of the upstream HTTP API,
   - spawns the compiled server with `GITHUB_API_BASE_URL` (or equivalent) pointed at the mock,
   - drives every tool over the MCP SDK `Client`,
   - asserts both the returned payload AND that the right HTTP routes were hit.
   This is the template's definition of "done" for an MCP server. If the smoke isn't green, the server isn't done.
6. **Clean shutdown on SIGINT/SIGTERM.** An enterprise agent runtime will restart MCP servers; a server that hangs on shutdown blocks that. Always wire signal handlers that close the transport and `process.exit(0)`.
7. **No agent-visible env vars beyond the pin and the token.** If a server needs a config knob the model could legitimately set, expose it as a tool argument with a Zod default. Do not invent new env vars the operator has to know about.

## How the rest of the priority-1 set should copy this

A Figma MCP server should ship with the same files, renamed:

```
mcp-servers/figma/
├── package.json            # @fora/mcp-figma
├── tsconfig.json
├── bin/fora-mcp-figma.mjs
├── src/
│   ├── config.ts           # FIGMA_TOKEN + FIGMA_FILE_KEY + FIGMA_TEAM_ID (+ API_BASE_URL, USER_AGENT)
│   ├── client.ts            # createClient → Figma REST v1 wrapper (hand-rolled fetch)
│   ├── tools.ts             # get_file, get_file_nodes, get_node, get_images, get_comments, post_comment
│   └── index.ts             # liveness call asserts the team-scope on startup
├── test/
│   ├── mock-figma.mjs       # mirrors /v1/files/{key}, /v1/files/{key}/nodes, /v1/images/{key}, /v1/files/{key}/comments
│   └── smoke.mjs
└── docs/template-note.md    # points back to this file
```

Jira and Confluence ship the same shape with their own per-API drift. When the next P2 server is built (Slack/Teams), copy `src/tools.ts` first, then `config.ts`, then `client.ts`, then the smoke test. The orchestrator agent will pick the right toolset for the task at runtime — it doesn't need to know which underlying MCP server is providing them, only the tool names.

## Figma contract drift

The Figma copy of the template holds to all seven points above. There are three areas where the Figma shape differs from the GitHub shape; all three are documented in the Figma server's README, and called out here so future servers can see them in one place:

1. **Two startup pins, not one.** Figma uses `FIGMA_FILE_KEY` (the actual file) plus `FIGMA_TEAM_ID` (the team whose token the file lives in). The file is the per-call safety property; the team is asserted on startup with a single `GET /v1/files/{key}` liveness call. The GitHub org is one level of pin; Figma's two-level pin is the same safety property expressed one level deeper (a team can hold many files; the file is the smallest unit a customer owns).
2. **Comments endpoint does not paginate by default.** Figma's public REST v1 `GET /v1/files/{key}/comments` returns all comments for a file in a single response. The `after` cursor is still exposed on `get_comments` and threaded through to the request, and the response shape is `{ comments, next? }` so the contract is forward-compatible. The smoke mock paginates so the server's `after` handling is locked in. Today, `next` will be `undefined` in production; the day Figma exposes a `cursor`, the server is already wired for it.
3. **No Figma SDK.** Figma's public REST v1 surface is not covered by a maintained TypeScript SDK we want to depend on. The client is hand-rolled over `fetch`, but still returns a typed `Client` interface from `createClient(config)`. The trade-off: no auto-pagination, no built-in retries. If we adopt retries later, do it inside the client so the tools' input/output shape stays stable.

## Acceptance bar (also the template's)

A new MCP server is done when:

- All required tools are registered with Zod raw shapes and a one-line description per tool.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all N tools smoke-tested green`.
- README follows the same sections as the GitHub one: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- `docs/template-note.md` is updated to list the new server and any contract drift it requires.
- A `request_review` comment on the implementation issue links the smoke transcript and lists the manual verification step (e.g. "with a real Figma PAT, `get_file` against the pinned file returns the marketing-site document tree").

Anything less is a draft.
