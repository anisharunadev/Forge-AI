# Template note — `forge-ai/mcp-aws` and the Forge AI MCP server template

This package copies the [Forge AI MCP server template](../../github/docs/template-note.md) defined by `forge-ai/mcp-github` (Forge AI-4). The seven contract points from the upstream template (single-scope pin, typed client, Zod raw shapes, stdout = JSON-RPC, mock-HTTP smoke, clean SIGINT/SIGTERM, no extra env vars) are **all preserved** in this package.

This file documents the **contract drift** the AWS server introduces. Anything not called out here matches the upstream contract verbatim.

## Contract drift vs. `forge-ai/mcp-github`

| Drift | What | Why | Backward-compatible? |
| --- | --- | --- | --- |
| **Pin is two-env, not one** | `AWS_ACCOUNT_ID` + `AWS_REGION` (both required at startup) | AWS authentication scopes the client to BOTH an account and a region; either is meaningful only in the context of the other. The server refuses to start if either is missing or if `STS:GetCallerIdentity` returns a different account. | Yes — purely additive on top of the "refuse to start without a pin" contract point. |
| **Optional `AWS_SKIP_CREDENTIAL_VERIFY=1`** | An env-var escape hatch for the boot-time `STS:GetCallerIdentity` call. | The smoke test points the SDK at a local mock that speaks the AWS JSON 1.1 protocol; the production boot path still calls STS. Real operators leave the env var unset. | Yes — the upstream contract's "no agent-visible env vars beyond pin + token" still holds; the model never reads this env var (it is operator-side). |
| **`AWS_ENDPOINT_URL` env var (smoke only)** | An operator-only override that points every AWS SDK client at a custom endpoint. | The smoke test points the SDK at a local mock; production never sets this. | Yes — same shape as `GITHUB_API_BASE_URL` / `JIRA_API_BASE_URL` in the upstream template. |
| **Mutations deferred to a follow-up** | The `execute_change_set` tool is **not** registered in this ticket. The original ticket scoped it behind a `confirm: true` Zod argument; the wake comment from the CEO narrowed v1 to a read-only surface. | The follow-up ticket will add `execute_change_set` (and any Cloud Control write tools) behind the planned `confirm: true` guard. When that lands, this template-note will gain a new row: "`confirm: true` Zod argument on destructive tools" (the only intentional contract addition vs. the github template). | Yes — and will be flagged as an additive contract change at that time per the upstream template's "anything that touches the contract needs an ADR + this file" rule. |
| **`get_change_set` and `describe_change_set` wire to the same AWS operation** | Both project the response of `DescribeChangeSet`; `describe_change_set` passes `IncludePropertyValues=true` and surfaces the nested-stack fields. | AWS collapsed the historical `GetChangeSet` and `DescribeChangeSet` operations into a single wire call years ago. We expose both names so the model can pick the verb it wants; the wire cost is one extra round trip in the "describe" case. | Yes — purely a model-facing projection choice. |
| **Credential resolution is delegated to the AWS SDK chain** | The server does not read `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` itself; it lets the SDK resolve the chain. | AWS supports many credential sources (env, shared config, web identity, ECS task role, EC2 instance role). Hard-coding one would break the others. The pin-and-verify happens via `STS:GetCallerIdentity` on boot. | Yes — matches how every official AWS SDK tool behaves. |

## What still matches the github template verbatim

- **Single-scope pin on startup.** `AWS_ACCOUNT_ID` + `AWS_REGION` are the pin; the model can only pass resource IDs.
- **Typed client wrapper.** `src/client.ts` exports a `createClient(config)` that returns a `Client` interface with one method per tool. No raw HTTP leaks into `tools.ts`.
- **Zod raw shapes as the source of truth.** Every tool in `src/tools.ts` carries a Zod raw shape fed to `McpServer.tool()`; the same shape is `Zod.object(...).strict().parse(...)`d at handler entry.
- **Stdout = JSON-RPC, stderr = logs.** All operational logs go to `process.stderr.write(...)`. `McpServer.connect(new StdioServerTransport())` is the only consumer of stdout.
- **Mock-HTTP smoke.** `test/smoke.mjs` boots `test/mock-aws.mjs` on a random port, points the SDK at it via `AWS_ENDPOINT_URL`, drives every tool over the MCP client, and asserts both the payloads AND the AWS operations the mock recorded.
- **Clean shutdown on SIGINT/SIGTERM.** Same handler pattern as the github template.
- **No agent-visible env vars beyond the pin and the credential resolution chain.** `AWS_SKIP_CREDENTIAL_VERIFY` and `AWS_ENDPOINT_URL` are operator-only; the model never reads them.

## How to copy this template further

The next P2 server (Zendesk or Databricks, per the 30/60/90 plan) should copy this package the same way this one copied the github package: keep the seven contract points, document the drift in `docs/template-note.md`, and ship a smoke test that proves the wire format round-trips.
