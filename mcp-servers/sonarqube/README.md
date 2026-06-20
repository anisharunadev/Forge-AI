# `@fora/mcp-sonarqube` — Forge AI SonarQube MCP Server

Priority-1 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes nine tools over MCP/stdio: `list_projects`, `get_project`, `search_components`, `get_component_measures`, `list_issues`, `get_issue`, `transition_issue`, `get_quality_gate`, `webhooks_get`.

The server is **pinned to a single SonarQube project** at startup. The model can pass `projectKey` as an argument, but it is asserted against the pinned project before any call lands. `transition_issue` is the only write tool; the rest are read-only.

This package is built from the `@fora/mcp-github` template ([Forge AI-4](/Forge AI/issues/Forge AI-4), [template note](docs/template-note.md)). The seven contract points in that template-note are mandatory and non-negotiable.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/sonarqube
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-sonarqube.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/sonarqube
npm pack          # produces fora-mcp-sonarqube-0.1.0.tgz
npm install -g ./fora-mcp-sonarqube-0.1.0.tgz
```

After global install, `fora-mcp-sonarqube` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "sonarqube": {
      "command": "fora-mcp-sonarqube",
      "env": {
        "SONARQUBE_TOKEN": "${SONARQUBE_TOKEN}",
        "SONARQUBE_PROJECT_KEY": "your-customer-project-key",
        "SONARQUBE_API_BASE_URL": "https://sonarcloud.io"
      }
    }
  }
}
```

The server reads these env vars on startup. If `SONARQUBE_TOKEN` or `SONARQUBE_PROJECT_KEY` is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses a **SonarQube user token** (or a SonarCloud user token). Tokens are passed via the standard `Authorization: Bearer <token>` header.

### Least-privilege setup

1. In SonarQube / SonarCloud, create a user (real or service) whose permissions are scoped to a single project.
2. Generate a user token for that user. SonarQube tokens are bound to a user, not a project, so the **user** must be project-scoped.
3. Required permissions for the user on the pinned project:
   - **Browse** (read) — for `list_projects`, `get_project`, `search_components`, `get_component_measures`, `list_issues`, `get_issue`, `get_quality_gate`, `webhooks_get`.
   - **Administer Issues** (read+write) — additionally required for `transition_issue`.
4. Set `SONARQUBE_TOKEN` to the generated token. Set `SONARQUBE_PROJECT_KEY` to the project key (e.g. `forge` for SonarCloud, or `my-org:my-project` for self-hosted).
5. (SonarCloud only) Optionally set `SONARQUBE_ORG` to the SonarCloud organization slug. The server asserts on startup that the pinned project belongs to that org.

### About `transition_issue`

`transition_issue` is the **only write tool** in the package. To perform a transition the caller must:

- Set `confirm: true` in the tool arguments. The Zod schema rejects `false` or omitted.
- Use a token whose underlying user has **Administer Issues** on the pinned project.

Both gates are enforced. A token without `Administer Issues` will receive an HTTP 403 from SonarQube; the server surfaces that as a `SonarApiError`. A token WITH the right permission but a `confirm: false` argument will fail the Zod parse and never reach the wire.

> **Why project-pinned, not server-wide?** A server-scoped token would let a confused or malicious agent prompt enumerate every project on the SonarQube instance. Project-pinning is a hard security boundary that the server enforces on every call.

---

## Tools

All tools that accept a `projectKey` (or a component key) assert it against `SONARQUBE_PROJECT_KEY`. If they don't match, the call is refused with `ProjectScopeError`.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `list_projects` | List projects visible to the token. | — | `organization`, `query`, `page`, `pageSize` |
| `get_project` | Get details for the pinned project. | — | `projectKey` (asserted against pin) |
| `search_components` | Search files/directories within the pinned project. | `query` | `page`, `pageSize` |
| `get_component_measures` | Read quality measures for a file/directory. | `component`, `metricKeys` | — |
| `list_issues` | List code-quality findings in the pinned project. | — | `severities`, `types`, `statuses`, `page`, `pageSize` |
| `get_issue` | Get a single issue by its SonarQube key. | `issueKey` | — |
| `transition_issue` | Apply a state transition to an issue. **Write path.** | `issueKey`, `transition`, `confirm: true` | `comment` |
| `get_quality_gate` | Get quality-gate status for the pinned project. | — | `projectKey` (asserted against pin) |
| `webhooks_get` | List recent webhook deliveries observed by the server. | — | `projectKey` (asserted against pin), `page`, `pageSize` |

### Example payloads

`list_projects`:

```json
{ "organization": "acme", "query": "forge" }
```

`search_components`:

```json
{ "query": "orchestrator" }
```

`get_component_measures`:

```json
{ "component": "forge:src/orchestrator.ts", "metricKeys": ["coverage", "ncloc", "code_smells"] }
```

`list_issues`:

```json
{ "severities": ["BLOCKER", "CRITICAL"], "statuses": ["OPEN", "REOPENED"] }
```

`transition_issue`:

```json
{
  "issueKey": "AYforge-002",
  "transition": "wontfix",
  "confirm": true,
  "comment": "Suppressed per team policy."
}
```

The server will auto-pin `componentKeys` on every `list_issues` call so the model can't drift to an adjacent project. The same applies to the `component` filter on `search_components`.

---

## Run the smoke test

The smoke test boots a mock SonarQube HTTP server, spawns the MCP server pointed at it, and exercises all 9 tools over stdio. It runs without any real SonarQube credentials.

```bash
cd mcp-servers/sonarqube
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 9 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid SonarQube MCP configuration: SONARQUBE_TOKEN is required` | Missing env var | Set `SONARQUBE_TOKEN` and `SONARQUBE_PROJECT_KEY` in the MCP client config. |
| `ProjectScopeError: Refusing to act on project 'foo' — this server is pinned to 'bar'` | The `projectKey` (or component prefix) didn't match the pinned project. | Either pass the pinned project as the key, or reconfigure the server for a different project (requires restart). |
| `WriteScopeRequiredError: Refusing to execute 'transition_issue' — …` | The call did not set `confirm: true`. | Set `confirm: true` in the tool arguments. |
| `SonarApiError: SonarQube POST /api/issues/do_transition failed: HTTP 403` | The token's user lacks `Administer Issues` on the pinned project. | Use a different token, or grant `Administer Issues` to the user on the pinned project. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `list_issues` returns 0 issues but the SonarQube UI shows some | The token's user has no Browse permission on the pinned project, or the project key has a typo. | Verify in SonarQube UI as the same user; double-check the `SONARQUBE_PROJECT_KEY` value. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for which MCP servers this package templates and the contract they share.
