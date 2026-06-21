# `forge-ai/mcp-zendesk` — Forge AI Zendesk MCP Server

P2 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes eight tools over MCP/stdio: `list_tickets`, `get_ticket`, `search_tickets`, `create_ticket`, `update_ticket`, `add_comment`, `list_macros`, `apply_macro`.

The server is **pinned to a single Zendesk subdomain** at startup. The model can pass ticket IDs, search queries, comment bodies, and macro IDs — never subdomain names. This is the safety property that lets us hand a customer a Zendesk API token and trust the agent won't escape into another customer's data.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/zendesk
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-zendesk.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/zendesk
npm pack          # produces fora-mcp-zendesk-0.1.0.tgz
npm install -g ./fora-mcp-zendesk-0.1.0.tgz
```

After global install, `fora-mcp-zendesk` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "zendesk": {
      "command": "fora-mcp-zendesk",
      "env": {
        "ZENDESK_SUBDOMAIN": "${ZENDESK_SUBDOMAIN}",
        "ZENDESK_EMAIL": "${ZENDESK_EMAIL}",
        "ZENDESK_API_TOKEN": "${ZENDESK_API_TOKEN}"
      }
    }
  }
}
```

The server reads all three env vars on startup. If any are missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses **Zendesk API token auth**, sent as Basic auth:

```
Authorization: Basic base64("{email}/token:{apiToken}")
```

### Token provisioning (least privilege)

1. In the Zendesk Admin Center, go to **Apps and integrations → APIs → Zendesk API**.
2. Enable **Token Access** if not already enabled.
3. Click **Add API token**, name it (e.g. `Forge AI MCP — <customer>`), and copy the token.
4. In the customer admin's **Manage → Team → Members**, set the **Role** to a **custom role** with the following scopes only:
   - **Tickets** — read
   - **Comments** — add
   - **Macros** — read
   - **Ticket Creation** — yes
   - **Everything else** — no
5. Set `ZENDESK_SUBDOMAIN` to the customer's subdomain (the part before `.zendesk.com`).
6. Set `ZENDESK_EMAIL` to the agent email and `ZENDESK_API_TOKEN` to the token from step 3.

> **Why subdomain-pinned, not user-pinned?** A user-scoped token would let a confused or malicious agent prompt call any Zendesk instance the user has access to. Subdomain-pinning is a hard security boundary that the server enforces on every call.

---

## Tools

| Tool | Purpose | Required args | Optional args | `confirm: true` |
| --- | --- | --- | --- | --- |
| `list_tickets` | List tickets in the pinned subdomain. | — | `page`, `perPage` | — |
| `get_ticket` | Get one ticket by ID, including its comment thread. | `ticketId` | — | — |
| `search_tickets` | Search tickets using Zendesk's full-text query syntax. | `query` | `page`, `perPage` | — |
| `create_ticket` | Create a new ticket. | `subject`, `comment` | `priority`, `status`, `tags`, `requesterEmail`, `requesterName`, `externalId` | **required** |
| `update_ticket` | Update an existing ticket. | `ticketId` | `subject`, `priority`, `status`, `tags`, `addTags`, `removeTags`, `comment`, `externalId` | **required** |
| `add_comment` | Append a comment to a ticket. | `ticketId`, `comment` | `public` | — |
| `list_macros` | List macros in the pinned subdomain. | — | `page`, `perPage` | — |
| `apply_macro` | Apply a macro to a ticket. | `ticketId`, `macroId` | — | — |

### Example payloads

`list_tickets`:

```json
{
  "perPage": 25,
  "page": 1
}
```

`get_ticket`:

```json
{
  "ticketId": 42
}
```

`create_ticket`:

```json
{
  "subject": "Smoke: MCP server connected",
  "comment": { "body": "Created by the Forge AI smoke test." },
  "priority": "high",
  "tags": ["smoke"],
  "confirm": true
}
```

`update_ticket`:

```json
{
  "ticketId": 42,
  "status": "open",
  "priority": "urgent",
  "addTags": ["escalated"],
  "confirm": true
}
```

`add_comment`:

```json
{
  "ticketId": 42,
  "comment": { "body": "## QA report\n\nSmoke test passed." },
  "public": true
}
```

`search_tickets`:

```json
{
  "query": "tags:smoke status:open"
}
```

---

## Run the smoke test

The smoke test boots a mock Zendesk REST v2 server, spawns the MCP server pointed at it, and exercises all 8 tools over stdio. It runs without any real Zendesk credentials.

```bash
cd mcp-servers/zendesk
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 8 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

The smoke also asserts:

- The Basic auth header sent to the mock matches `base64("{email}/token:{apiToken}")` exactly on every HTTP call.
- `create_ticket` and `update_ticket` reject `confirm: false` at the Zod validation layer and make **zero** HTTP calls.
- Every recorded HTTP route matches the expected Zendesk REST v2 path shape.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Zendesk MCP configuration: ZENDESK_SUBDOMAIN is required` | Missing env var | Set all three of `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`. |
| `Zendesk API 401` on every call | Token is wrong, revoked, or scoped to a different agent. | Reissue the API token in Zendesk Admin Center; verify `ZENDESK_EMAIL` matches the agent the token is issued for. |
| `Zendesk API 403` on `create_ticket` | The agent's role lacks the `Ticket Creation` scope. | Update the agent's custom role in Manage → Team → Members to include `Ticket Creation`. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `create_ticket` / `update_ticket` rejected with a Zod error mentioning `confirm` | The Zod literal `confirm: true` was missing or set to `false`. | The mutation tools require an explicit `confirm: true` to prevent silent mutations. Pass `confirm: true` in the call. |
| `apply_macro` returns a 404 with `Macro {id} not found` | The macro ID isn't visible to the authenticated agent. | Use `list_macros` to discover visible macro IDs, or grant the agent's role access to the macro in Zendesk Admin Center. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for which MCP servers this package templates (GitHub, Jira, Confluence, AWS, SonarQube, Azure DevOps) and the contract they share.
