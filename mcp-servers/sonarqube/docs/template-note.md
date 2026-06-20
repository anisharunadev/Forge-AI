# Template note — which MCP servers `@fora/mcp-sonarqube` is built from

This package is **built from** the `@fora/mcp-github` template ([Forge AI-4](/Forge AI/issues/Forge AI-4)). The seven contract points in the GitHub template-note are the source of truth and are not relaxed for this server. This file records the contract points and any local drift required to apply them to SonarQube.

## Source template

| Server | Priority | Status | Role for this package |
| --- | --- | --- | --- |
| [`@fora/mcp-github`](/Forge AI/issues/Forge AI-4) | P1 | shipped | Source template. All seven contract points ported verbatim. |

## The seven contract points as applied here

1. **Single-scope pin on startup.** The server refuses to start without `SONARQUBE_PROJECT_KEY`. The model can pass a `projectKey` (or a component key, e.g. `forge:src/foo.ts`), but it is asserted against the pin before any call lands. The optional `SONARQUBE_ORG` is asserted on startup by fetching the pinned project and checking its `organization` field (SonarCloud only).
2. **Typed client wrapper.** `createClient(config)` returns a `Client` interface with nine methods. The client takes only IDs and primitives, never raw HTTP. Implemented in `src/client.ts` over the built-in `fetch` (Node ≥18.17) — no Octokit dependency because SonarQube's v1 API is plain JSON / form-urlencoded, not GraphQL.
3. **Zod raw shapes as the source of truth.** Each tool definition carries a Zod raw shape (`{ issueKey: z.string(), ... }`) which is fed to `McpServer.tool()` and also used to validate runtime input inside `handleToolCall`. No JSON Schemas.
4. **Stdout = JSON-RPC, stderr = logs.** All operational output (startup banner, signal handlers, fatal errors) goes to stderr. stdout is reserved for the JSON-RPC stream. The smoke test asserts this contract: the only lines allowed on stderr are the startup line and the shutdown line.
5. **Smoke test pattern: mock HTTP + spawn server + drive via MCP client.** `test/smoke.mjs` boots a local mock of the SonarQube v1 REST API (`test/mock-sonarqube.mjs`), spawns the compiled server pointed at it via `SONARQUBE_API_BASE_URL`, drives every tool over the MCP SDK `Client`, and asserts both the returned payload AND the recorded HTTP routes. This is the template's definition of "done" — the smoke ends with `[smoke] done: all 9 tools smoke-tested green`.
6. **Clean shutdown on SIGINT/SIGTERM.** An enterprise agent runtime will restart MCP servers; a server that hangs on shutdown blocks that. Both signals close the transport and `process.exit(0)`.
7. **No agent-visible env vars beyond the pin and the token.** The only env vars the operator sets are `SONARQUBE_TOKEN`, `SONARQUBE_PROJECT_KEY`, and the optional `SONARQUBE_ORG` (SonarCloud org slug, asserted on startup), `SONARQUBE_API_BASE_URL` (smoke tests), `SONARQUBE_USER_AGENT` (default `fora-mcp-sonarqube/0.1.0`). `confirm: true` is exposed as a tool argument with a Zod literal type, not as an env var, to satisfy the same property.

## Local drift from the GitHub template

| Area | GitHub | SonarQube | Reason |
| --- | --- | --- | --- |
| HTTP client | `@octokit/rest` | Built-in `fetch` | SonarQube v1 is plain REST + form-urlencoded; no need for an SDK. Keeps the dependency surface small. |
| Pin granularity | `GITHUB_ORG` (org-wide) | `SONARQUBE_PROJECT_KEY` (one project) | SonarQube's smallest sensible scope is a project. The model can still pass a `projectKey` to `get_project` and it is asserted. |
| Org assertion | n/a | Optional `SONARQUBE_ORG` asserted on startup | SonarCloud projects live under an org; the assertion is a no-op on SonarQube Server. |
| GraphQL path | `create_issue` migrated to GraphQL (Forge AI-14) | n/a — SonarQube has no GraphQL | Every tool here is plain REST. |
| Write path | `create_pr_comment` requires the `Pull requests: read and write` PAT scope | `transition_issue` requires `Administer Issues` on the pinned project AND `confirm: true` in the call | The write tool is the deliberate exception; both gates are enforced. |
| Search escaping | `search_code` auto-appends `org:<pin>` | `list_issues` and `search_components` auto-pin to the project | Same safety property: the model can't drift to an adjacent resource. |

No contract drift was introduced. The seven points above are honoured verbatim.
