# `@fora/mcp-github` — FORA GitHub MCP Server

Priority-1 MCP server for the FORA Enterprise AI SDLC Operating System. Exposes seven tools over MCP/stdio: `list_repos`, `get_pr`, `list_prs`, `create_pr_comment`, `list_issues`, `create_issue`, `search_code`.

The server is **pinned to a single GitHub org** at startup. The model can pass `owner` as an argument, but it is asserted against the pinned org before any call lands. This is the safety property that lets the same server template drive Jira and Confluence integrations.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/github
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-github.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/github
npm pack          # produces fora-mcp-github-0.1.0.tgz
npm install -g ./fora-mcp-github-0.1.0.tgz
```

After global install, `fora-mcp-github` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "github": {
      "command": "fora-mcp-github",
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}",
        "GITHUB_ORG": "your-customer-org"
      }
    }
  }
}
```

The server reads both env vars on startup. If either is missing, it exits with a non-zero status and a clear message naming the offending variable.

---

## Authentication

The server supports either a **Personal Access Token (PAT)** or a **GitHub App installation token**. Either is fine — choose based on how you manage customer credentials.

### Option A — Fine-grained PAT (simplest for dev)

1. Visit `Settings → Developer settings → Personal access tokens → Fine-grained tokens`.
2. **Resource owner** = the single org you want this server pinned to.
3. **Repository access** = `All repositories` (or the specific repos the customer pre-approves).
4. **Permissions** (least privilege):
   - Repository → Metadata: read-only (always required)
   - Pull requests: read and write
   - Issues: read and write
   - Code: read-only (covers `search_code`)
5. Set `GITHUB_TOKEN` to the resulting token. Set `GITHUB_ORG` to the org login.

### Option B — GitHub App (recommended for production)

1. Register a GitHub App owned by the customer org. Single-org install only.
2. App permissions (least privilege):
   - Repository: Metadata (read)
   - Pull requests: Read & Write
   - Issues: Read & Write
   - Code: Read
3. Install the app on the customer org. Generate an installation access token.
4. Set `GITHUB_TOKEN` to the installation token and `GITHUB_ORG` to the org login.
5. Rotate the installation token on a schedule (or use a token-mint service that does).

> **Why org-pinned, not user-pinned?** A user-scoped token would let a confused or malicious agent prompt call repos across every org the user has access to. Org-pinning is a hard security boundary that the server enforces on every call.

---

## Tools

All tools take an `owner` arg that is asserted against `GITHUB_ORG`. If they don't match, the call is refused with `OrgScopeError`.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `list_repos` | List repos in the pinned org. | — | `per_page`, `page`, `type` (`all`\|`public`\|`private`) |
| `get_pr` | Get one PR by number. | `owner`, `repo`, `pull_number` | — |
| `list_prs` | List PRs in a repo. | `owner`, `repo` | `state` (`open`\|`closed`\|`all`), `per_page`, `page` |
| `create_pr_comment` | Post a GFM comment on a PR. | `owner`, `repo`, `pull_number`, `body` | — |
| `list_issues` | List issues in a repo. | `owner`, `repo` | `state`, `per_page`, `page` |
| `create_issue` | Create an issue. | `owner`, `repo`, `title` | `body`, `labels` |
| `search_code` | Search code (auto-scoped to the pinned org). | `q` | `per_page`, `page` |

### Example payloads

`list_repos`:

```json
{
  "per_page": 10,
  "type": "private"
}
```

`get_pr`:

```json
{
  "owner": "your-customer-org",
  "repo": "forge",
  "pull_number": 7
}
```

`create_pr_comment`:

```json
{
  "owner": "your-customer-org",
  "repo": "forge",
  "pull_number": 7,
  "body": "## QA report\n\nSmoke test passed. Ready for review."
}
```

`search_code`:

```json
{
  "q": "OrgScopeError repo:forge"
}
```

The server will auto-append ` org:your-customer-org` if your query doesn't already pin an org. This means the model can't escape scope via a malicious query string.

---

## Run the smoke test

The smoke test boots a mock GitHub HTTP server, spawns the MCP server pointed at it, and exercises all 7 tools over stdio. It runs without any real GitHub credentials.

```bash
cd mcp-servers/github
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 7 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real network is touched.

### Live smoke (against the real api.github.com)

The mock-backed smoke above proves the wiring is correct. To prove the server
also works against the real GitHub API, the `smoke:live` script spawns the
server pointed at `https://api.github.com` and exercises every tool. It also
asserts on the org-pinning denial and the rate-limit / auth-error paths.

```bash
cd mcp-servers/github
npm run build
export GITHUB_TOKEN=<a real PAT or installation token with repo+read:org>
export GITHUB_ORG=<the org this token can reach>
export GITHUB_REPO=<a repo inside that org with at least one open PR>
export PR_NUMBER=<that PR's number>   # optional, defaults to 6
npm run smoke:live
```

Required scopes for the token (least privilege):

- Repository → Metadata: read-only
- Pull requests: read and write
- Issues: read and write
- Code: read-only (covers `search_code`)

The live smoke writes real PR comments and creates a real issue, so point it
at a sandbox repo, not a customer repo. Expected output ends with:

```
[live] done: all 7 tools live-tested green against api.github.com
```

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid GitHub MCP configuration: GITHUB_TOKEN is required` | Missing env var | Set `GITHUB_TOKEN` and `GITHUB_ORG` in the MCP client config. |
| `OrgScopeError: Refusing to act on org 'foo' — this server is pinned to 'bar'` | The `owner` arg didn't match the pinned org. | Either pass the pinned org as `owner`, or reconfigure the server for a different org (requires restart). |
| `MCP error -32000: Connection closed` on first call | The child process died at startup. | Check stderr — usually a config error or a missing dist/ build. |
| `search_code` returns no results | The query is too narrow, or the org qualifier was malformed. | Drop the `org:` prefix and let the server add it; check GitHub's code search requires an `org:` or `user:` qualifier. |
| `LabelNotFoundError: Labels not found in owner/repo: …` from `create_issue` | FORA-14: `create_issue` was migrated to the GraphQL `createIssue` mutation, which requires labels to already exist in the target repo. | Create the labels in the repo first (Settings → Labels), or omit `labels` from the call. |
| `create_issue` hits an unexpected GraphQL rate-limit / 502 | FORA-14: the new path goes through GraphQL, which has different rate-limit semantics than REST. | See "Rate-limit implications of `create_issue` (FORA-14)" below. |
| Operator dashboard expected an `[@octokit/request] …/search/code… is deprecated` warning and doesn't see one | FORA-13: the warning is suppressed at source by a custom Octokit logger because GitHub's deprecation header refers only to fields/params we don't consume. | This is intentional. See "Code-search backend (FORA-13)" below. The smoke and live smoke both assert the warning never reaches stderr. |

---

## Rate-limit implications of `create_issue` (FORA-14)

The `create_issue` tool was migrated from the deprecated REST `POST /repos/{owner}/{repo}/issues` (sunset **Fri, 10 Mar 2028**) to GitHub's GraphQL `createIssue` mutation. The tool's input/output shape is unchanged — callers see the same `{ number, title, html_url, state }` return — but the network path is now GraphQL, which has different rate-limit semantics:

- **Primary rate limit is point-based, not request-based.** GraphQL charges a per-hour point budget (5,000 points/hour for authenticated users; 12,500 for GitHub Apps). Each operation's cost depends on its complexity. A `createIssue` mutation with no labels costs ~1 point; a `createIssue` with N label IDs costs more, plus the `ResolveRepoAndLabels` query (typically 1 point). The repo Node ID is cached in-process, so the resolve query is only issued once per repo per process lifetime.
- **Secondary rate limit is point-based too.** Mutations cost 5 points on the secondary rate limit. If a workload calls `create_issue` in a tight loop, expect secondary rate-limit responses (HTTP 200 with `errors[].type = "RATE_LIMITED"`, plus a `Retry-After` header) where the old REST path would simply have returned HTTP 403. Treat any GraphQL error containing `RATE_LIMITED` as a backoff signal and do not retry the same mutation within the `Retry-After` window.
- **Labels must exist.** GraphQL `createIssue` accepts `labelIds` (not label names), and there is no auto-create. If a requested label is missing, the tool throws `LabelNotFoundError` listing the missing names — this matches the prior REST 422 behavior of "label does not exist", but the failure surface is now a typed error rather than a 422 response.
- **Mutations and OAuth/PAT scopes are unchanged.** The token still needs `Issues: read and write` on the target repo. No new scope was introduced; the same fine-grained PAT or GitHub App install that worked before still works.

If a caller was relying on the deprecation warning as a signal that the REST endpoint was active, note that the warning no longer fires for `create_issue` at all. Operators watching `api.github.com` traffic for deprecated calls should update their dashboards: the new call shape is `POST /graphql` with a `createIssue` mutation in the body, not `POST /repos/{owner}/{repo}/issues`.

---

## Reuse: the FORA MCP server template

See `docs/template-note.md` for which MCP servers this package templates (Jira, Confluence) and the contract they share.

---

## Code-search backend (FORA-13)

`search_code` is backed by the REST `GET /search/code` endpoint via Octokit. GitHub returns a `Deprecation: true` and `Sunset: Sun, 27 Sep 2026 …` header on every response, which Octokit would normally surface as:

```
[@octokit/request] "GET …/search/code…" is deprecated. It is scheduled to be removed on Sun, 27 Sep 2026 …
```

### What is actually deprecated

Per [GitHub's REST search reference](https://docs.github.com/en/rest/search/search), only specific response **fields** and the `sort`/`order` query parameters are closing down — not the endpoint itself. The deprecated items are:

- `repository.description`
- `repository.owner.type`
- `repository.owner.node_id`
- `sort` query parameter
- `order` query parameter

The MCP server's `toCodeSearchHit` mapper only reads `name`, `path`, `repository.full_name`, `html_url`, and `score` — none of which are on the deprecation list. We also don't pass `sort` or `order`. The response shape we return to callers is unaffected by the closing-down fields.

### Why we keep REST `/search/code` for now

- The public **GraphQL** `search(type: CODE)` is not generally available outside of preview, so we can't migrate to it as a stable replacement today.
- The new **GitHub Code Search** API (the engine behind `gh search code`) is not GA either.
- A **third-party indexer** (Sourcegraph, etc.) would add a new auth surface, a new cost line, and a new failure mode. Not worth it until the deprecation header actually becomes a removal.
- The REST endpoint itself has **no endpoint-level removal** in GitHub's published REST breaking-change list. Our consumed fields are safe through the published 2026-03-10 / `has_downloads` removal window and beyond.

### What the server does to keep things clean

- Pins `X-GitHub-Api-Version: 2022-11-28` on every request so the deprecation timeline matches what GitHub's docs describe.
- Threads a custom Octokit logger through `request.log` (the per-request slot `@octokit/request`'s `fetch-wrapper.js` actually reads from) so a single, targeted warning — the `/search/code` deprecation line — is suppressed at source. Every other Octokit warning still flows to stderr unchanged. See `src/client.ts` `SEARCH_CODE_DEPRECATION_PATTERN`.
- Both smoke harnesses assert that the deprecation warning never reaches stderr from a `/search/code` call:
  - `npm run smoke` — the mock server returns the same `Deprecation` / `Sunset` / `Link` headers GitHub does, so the suppression is verified against the real header path.
  - `npm run smoke:live` — captures the MCP server's stderr via `StdioClientTransport({ stderr: "pipe" })` and fails if `[@octokit/request] …/search/code… is deprecated` ever appears.

### Re-evaluation milestone

We re-evaluate the choice of backend before **August 2026**, with two prototypes in mind:

- GraphQL `search(type: CODE)` if it graduates to GA, **and/or**
- A roll-your-own indexer over `list_repos` + `git ls-tree` results, scoped to the pinned org.

If GitHub announces an actual endpoint removal before then, we move sooner.

