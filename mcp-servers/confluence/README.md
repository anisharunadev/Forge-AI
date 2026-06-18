# `@fora/mcp-confluence` — FORA Confluence MCP Server

Priority-1 MCP server for the FORA Enterprise AI SDLC Operating System. Exposes five tools over MCP/stdio: `list_pages`, `get_page`, `create_page`, `update_page`, `add_comment`.

The server is **pinned to a single Confluence space** at startup. The model can pass `page_id` as an argument, but it is asserted against the pinned space before any call lands. This is the safety property that lets the same server template drive Jira, GitHub, and Confluence integrations uniformly.

The server speaks the **Confluence Cloud REST v2** API. It uses **Basic auth** (Atlassian email + API token) over HTTPS. On startup, it resolves the configured space key (`CONFLUENCE_SPACE_KEY`) to the numeric space id that v2 requires.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/confluence
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-confluence.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/confluence
npm pack          # produces fora-mcp-confluence-0.1.0.tgz
npm install -g ./fora-mcp-confluence-0.1.0.tgz
```

After global install, `fora-mcp-confluence` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "confluence": {
      "command": "fora-mcp-confluence",
      "env": {
        "CONFLUENCE_BASE_URL": "https://your-customer.atlassian.net/wiki",
        "CONFLUENCE_EMAIL": "${CONFLUENCE_EMAIL}",
        "CONFLUENCE_API_TOKEN": "${CONFLUENCE_API_TOKEN}",
        "CONFLUENCE_SPACE_KEY": "ENG"
      }
    }
  }
}
```

The server reads all four env vars on startup. If any is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server uses **Basic auth** with an Atlassian API token. Generate one per service account — never reuse a personal token in a multi-agent pipeline.

1. Visit `https://id.atlassian.com/manage-profile/security/api-tokens` (must be logged in to the customer's Atlassian site).
2. Click **Create API token**. Label it `fora-mcp-confluence (CI)`.
3. Copy the token into `CONFLUENCE_API_TOKEN`. Set `CONFLUENCE_EMAIL` to the account email.
4. Set `CONFLUENCE_BASE_URL` to the customer's Confluence Cloud URL, e.g. `https://acme.atlassian.net/wiki`.
5. Set `CONFLUENCE_SPACE_KEY` to the single space this server is allowed to read and write, e.g. `ENG`. You can read it from the URL when viewing any page in the space: `…/wiki/spaces/ENG/…` → `ENG`.

### Required Confluence permissions

The API token inherits the permissions of the account that owns it. The account must have, at minimum, **Read** on the pinned space (for `list_pages` / `get_page` / `add_comment`) and **Add / Edit pages** (for `create_page` / `update_page`).

> **Why space-pinned, not user-pinned?** A user-scoped token would let a confused or malicious agent prompt read or write every page the user can see across every Atlassian site they have access to. Space-pinning is a hard security boundary that the server enforces on every call.

---

## Tools

All tools take a `page_id` arg that is asserted against the pinned space. If the page does not belong to the pinned space, the call is refused with `SpaceScopeError`.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `list_pages` | List pages in the pinned space. | — | `limit`, `cursor`, `title` |
| `get_page` | Get one page by id, including current version. | `page_id` | — |
| `create_page` | Create a page in the pinned space. | `title`, `body` | `parent_id` |
| `update_page` | Update a page's title and body. | `page_id`, `title`, `body`, `version_number` | — |
| `add_comment` | Post a footer comment on a page. | `page_id`, `body` | — |

### Storage format

`body` is **Confluence storage format** (an XHTML-like subset). The most common building blocks:

```html
<h1>Heading</h1>
<p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>
<ul><li>Bullet</li></ul>
<ol><li>Numbered</li></ol>
<a href="https://example.com">Link</a>
<ac:link><ri:page ri:content-title="Other page" /></ac:link>
```

For rich ADF/Atlas-style content, use the Confluence web editor and copy the storage-format XML back into the agent's `body` arg.

### Example payloads

`list_pages`:

```json
{
  "limit": 50,
  "title": "Runbook"
}
```

`get_page`:

```json
{
  "page_id": "10001"
}
```

`create_page`:

```json
{
  "title": "Release notes — v0.1.0",
  "body": "<h1>v0.1.0</h1><p>Initial FORA MCP Confluence integration.</p>"
}
```

`update_page` (read the current version first via `get_page`):

```json
{
  "page_id": "10001",
  "title": "Release notes — v0.1.0 (updated)",
  "body": "<h1>v0.1.0</h1><p>Updated by the FORA MCP server.</p>",
  "version_number": 4
}
```

`add_comment`:

```json
{
  "page_id": "10001",
  "body": "<p>QA approved. Ready to publish.</p>"
}
```

---

## Run the smoke test

The smoke test boots a mock Confluence v2 HTTP server, spawns the MCP server pointed at it, and exercises all 5 tools over stdio. It runs without any real Confluence credentials.

```bash
cd mcp-servers/confluence
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 5 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid Confluence MCP configuration: CONFLUENCE_API_TOKEN is required` | Missing env var | Set all four required env vars in the MCP client config. |
| `Failed to resolve Confluence space key 'ENG'` at startup | Space key is wrong, or the account can't see the space. | Verify the space exists at `https://<site>.atlassian.net/wiki/spaces/ENG` while logged in as the token's account. |
| `SpaceScopeError: Refusing to act on space '9002' — this server is pinned to '9001'` | The page's spaceId does not match the pinned space. | Pass a `page_id` that belongs to the pinned space, or reconfigure `CONFLUENCE_SPACE_KEY` (requires restart). |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing `dist/` build. |
| `update_page` returns 409 Conflict | Stale `version_number`. | Call `get_page` again and use the freshly returned `version.number`. |

---

## Reuse: the FORA MCP server template

See `docs/template-note.md` for which MCP servers this package templates (Jira, GitHub) and the contract they share.
