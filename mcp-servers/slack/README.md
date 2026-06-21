# `forge-ai/mcp-slack` — Forge AI Slack MCP Server

Priority-1 MCP server for the Forge AI Enterprise AI SDLC Operating System. Exposes seven tools over MCP/stdio: `list_channels`, `list_threads`, `get_thread`, `post_message`, `update_message`, `add_reaction`, `search_messages`.

The server is **pinned to a single Slack workspace** at startup. The model can pass a `channel` id as an argument, but it is asserted against the pinned workspace (`SLACK_TEAM_ID`) on every call. This is the safety property that lets the same server template drive Jira, Confluence, GitHub, and (forthcoming) Teams integrations.

**DMs are out of scope.** The agent surface only addresses channels. Slack DMs are never returned by `list_channels` and never accepted as a `channel` argument.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/slack
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-slack.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/slack
npm pack          # produces fora-mcp-slack-0.1.0.tgz
npm install -g ./fora-mcp-slack-0.1.0.tgz
```

After global install, `fora-mcp-slack` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "slack": {
      "command": "fora-mcp-slack",
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_TEAM_ID": "T0123YOURWORKSPACE"
      }
    }
  }
}
```

The server reads both env vars on startup. If either is missing, it exits with a non-zero status and a clear message naming the offending variable. If the token's `auth.test` returns a `team_id` that does not match the pin, the server also exits non-zero on startup (not on the first user call) so a misconfiguration is caught immediately.

---

## Authentication

The server uses a **Slack bot token** (`xoxb-…`). User tokens (`xoxp-…`) and legacy webhook URLs are not supported — bot tokens give us a per-workspace scope boundary and the standard `auth.test` workspace assertion we use for the pin.

### Option A — Slack app + bot token (recommended)

1. Visit [https://api.slack.com/apps](https://api.slack.com/apps) and create (or pick) a Slack app owned by the customer workspace.
2. **Install the app to a single workspace.** Multi-workspace installs are intentionally not supported — the server is pinned to one.
3. **Bot Token Scopes** (least privilege, matches the seven tools in this server):
   - `channels:read` — `list_channels`, `get_thread`, `list_threads`
   - `channels:history` — `list_threads`, `get_thread`
   - `groups:read` — `list_channels` (private channels)
   - `groups:history` — `list_threads`, `get_thread` (private channels)
   - `chat:write` — `post_message`
   - `chat:write.public` — `post_message` to public channels the bot hasn't been added to
   - `reactions:write` — `add_reaction`
   - `search:read` — `search_messages`
4. Install the app to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
5. Set `SLACK_BOT_TOKEN` to the token. Set `SLACK_TEAM_ID` to the workspace id (find it in Slack's workspace settings, or call `auth.test` once and read the `team_id` field).

### Option B — Bot token rotation via a token-mint service

For production, mint the bot token through a service that rotates it on a schedule (e.g. Vault, AWS Secrets Manager rotation, or a custom mint that re-installs the app nightly). The MCP server reads `SLACK_BOT_TOKEN` once at startup; rotation requires a server restart. If you need zero-downtime rotation, run two server instances behind a load balancer and rotate one at a time.

> **Why workspace-pinned, not user-pinned?** A user-scoped token would let a confused or malicious agent prompt reach every workspace the user is in. Workspace-pinning is a hard security boundary that the server enforces on every call.

---

## Tools

| Tool | Purpose | Required args | Optional args | Notes |
| --- | --- | --- | --- | --- |
| `list_channels` | List channels in the pinned workspace. | — | `limit`, `cursor`, `types` | DMs are never returned (default `types=public_channel,private_channel`). |
| `list_threads` | List thread parents in a channel. | `channel` | `limit`, `oldest`, `latest` | Filters history to messages with `reply_count > 0`. |
| `get_thread` | Get the parent + every reply in a thread. | `channel`, `thread_ts` | `limit` | Returns messages in chronological order. |
| `post_message` | Post a message to a channel. | `channel`, `text`, `confirm: true` | `thread_ts` | **Human-in-the-loop gate.** |
| `update_message` | Edit a message the bot posted. | `channel`, `ts`, `text`, `confirm: true` | — | **Human-in-the-loop gate.** Slack only allows editing messages the bot authored. |
| `add_reaction` | Add an emoji reaction to a message. | `channel`, `ts`, `name` | — | Idempotent — adding twice is a no-op. |
| `search_messages` | Search messages across the workspace. | `query` | `count`, `page` | Workspace-scoped by the token; no `team:` qualifier needed. |

### The `confirm: true` gate

`post_message` and `update_message` are **destructive, externally visible, and financial-adjacent** in spirit (they put words in a customer's mouth in front of their team). Per Forge AI-5 §5.2, the orchestrator halts and asks before any action that is destructive / irreversible / externally visible; the model achieves that for these two tools by passing `confirm: true` in the Zod literal. A confused or malicious prompt that calls `post_message` without it gets a Zod validation error back, not a posted message.

This is implemented in `src/tools.ts` as `confirm: z.literal(true).describe("Must be exactly true. …")` — the Zod schema rejects anything else before any HTTP call lands.

### Example payloads

`list_channels`:

```json
{
  "limit": 50,
  "types": "public_channel,private_channel"
}
```

`list_threads`:

```json
{
  "channel": "C0123YOURCHANNEL",
  "limit": 20
}
```

`get_thread`:

```json
{
  "channel": "C0123YOURCHANNEL",
  "thread_ts": "1700000010.000200"
}
```

`post_message`:

```json
{
  "channel": "C0123YOURCHANNEL",
  "text": "## QA report\n\nSmoke test passed. Ready for review.",
  "confirm": true
}
```

`update_message`:

```json
{
  "channel": "C0123YOURCHANNEL",
  "ts": "1700000010.000200",
  "text": "## QA report (edited)\n\nSmoke test passed. Ready for review.",
  "confirm": true
}
```

`add_reaction`:

```json
{
  "channel": "C0123YOURCHANNEL",
  "ts": "1700000010.000200",
  "name": "white_check_mark"
}
```

`search_messages`:

```json
{
  "query": "in:#forge org:Acme",
  "count": 10
}
```

---

## Run the smoke test

The smoke test boots a mock Slack Web API server, spawns the MCP server pointed at it, and exercises all 7 tools over stdio. It runs without any real Slack credentials.

```bash
cd mcp-servers/slack
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 7 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched. The smoke also covers:

- **Startup workspace pin** — `auth.test` is called eagerly in `index.ts`; a wrong-workspace token would fail fast. The smoke sets `SLACK_TEAM_ID` to the mock's `teamId` and asserts the startup call landed.
- **Per-call channel scope** — a call with a channel id the mock doesn't know (`C_UNKNOWN`) is refused with `ChannelScopeError` (surfaced as `isError: true` over MCP). This is the same safety property the github server's `OrgScopeError` provides.
- **`confirm: true` enforcement** — `post_message` without `confirm: true` is rejected by the Zod schema before any HTTP call lands. The mock never sees the request.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Slack MCP configuration: SLACK_BOT_TOKEN is required` | Missing env var | Set `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID` in the MCP client config. |
| Server exits with `startup team check failed: Refusing to act on workspace '…' — this server is pinned to '…'` | The bot token's `auth.test` returned a different `team_id` than `SLACK_TEAM_ID`. | Either set `SLACK_TEAM_ID` to the token's actual workspace id, or use a token installed in the pinned workspace. The startup check is eager so this fails immediately, not on the first user call. |
| `ChannelScopeError: Refusing to act on channel '…' — it does not belong to pinned workspace '…'` | The channel id either doesn't exist in Slack or belongs to a different workspace. | Verify the channel id (`C…` for public, `G…` for private). If the channel is in the pinned workspace, ensure the bot is a member of private channels it needs to read. |
| `SlackApiError: 'missing_scope'` on `search_messages` | The bot token lacks `search:read`. | Add the scope to the Slack app config and reinstall to the workspace. |
| `post_message` returns a Zod validation error | The call omitted `confirm: true` or set it to a non-`true` value. | This is intentional. The orchestrator/operator must explicitly pass `confirm: true` for any external write. |
| `update_message returns 'cant_update_message'` | The bot tried to edit a message it didn't author, or the message is older than Slack's edit window. | Slack only allows bots to edit their own messages, and the edit window varies. Have a human edit if the bot didn't post it. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error, a missing `dist/` build, or a wrong-workspace token. |

---

## Reuse: the Forge AI MCP server template

See `docs/template-note.md` for which MCP servers this package templates (Jira, Confluence, GitHub) and the contract they share. The forthcoming Teams MCP (P2) will copy the same template; only the auth (Graph API + `TEAMS_ACCESS_TOKEN`) and call surface differ.

---

## Why no Slack SDK?

The Slack Web API is stable enough to call directly with `fetch`, and avoiding the SDK keeps the package small and the auth story obvious (one `Authorization: Bearer xoxb-…` header, parsed by hand in `src/client.ts`). This mirrors the jira server's SDK-free stance. If a future Slack API change makes the surface unwieldy, we can adopt `@slack/web-api` without changing the tool surface or the seven contract points — the rest of the system only sees the typed `Client` interface.
