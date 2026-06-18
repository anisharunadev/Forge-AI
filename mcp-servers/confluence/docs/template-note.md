# Template note — which MCP servers `@fora/mcp-confluence` templates for

This package is the **third concrete MCP server** in the FORA priority-1 set, after `@fora/mcp-github` and `@fora/mcp-jira`. Zendesk, Databricks, and Azure DevOps are P2 and will follow the same template.

## Servers that copy this template (or vice-versa)

| Server | Priority | Status | Differences vs. confluence |
| --- | --- | --- | --- |
| `@fora/mcp-github` | P1 | shipped | Org-pinned (not space-pinned); `repo` / `pull_number` not `page_id`; uses GFM not storage format. |
| `@fora/mcp-jira` | P1 | shipped | Site-pinned (cloudId) not space-pinned; `issue_key` not `page_id`; uses ADF / Jira REST v3. |
| `@fora/mcp-confluence` | P1 | shipped (this issue) | n/a |

The three P1 servers share the same template — see `@fora/mcp-github/docs/template-note.md` for the full contract. This file notes only the Confluence-specific drift.

## Confluence-specific contract drift

1. **Pin type is `CONFLUENCE_SPACE_KEY`** (a human-readable string like `ENG`), not a numeric id. The server resolves the key to the numeric `spaceId` that v2 requires **on startup** via a single `GET /api/v2/spaces?keys=…` call. If the lookup fails, the server refuses to boot — same as the org-pinned github server.
2. **Auth is Basic (email + API token)**, not Bearer. The `Authorization: Basic <base64>` header is built once from `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` and re-used for every call.
3. **Body format is Confluence storage format** (an XHTML-like subset), not Markdown and not full ADF. The v2 API accepts `representation: "storage"` and returns it back. The MCP server is a thin pass-through; it does not transform the body.
4. **Page identity is `page_id`** (numeric string). It is asserted against the pinned space on every `get_page`, `update_page`, and `add_comment` call. `SpaceScopeError` is raised if the page belongs to another space.
5. **Updates require a `version_number`.** Confluence's v2 PATCH endpoint rejects stale writes; the model is expected to call `get_page` first, read the current `version.number`, and pass it back. The MCP server surfaces this in the `update_page` Zod shape and in the tool description.
6. **One round-trip for the space resolve.** The startup cost is one extra `GET /api/v2/spaces` call. We do not cache it across restarts — restart the server if you need to point it at a different space.

## How a future server should copy this

If you are building a fourth FORA MCP server (Zendesk, Databricks, or Azure DevOps), the right move is:

1. Copy `src/config.ts` first, rename the env vars to match your upstream's auth model.
2. Copy `src/client.ts`, change the URL builder, the `createClient` bootstrap (resolve the pin), and the per-method endpoint paths.
3. Copy `src/tools.ts`, replace the tool set with what your upstream actually exposes.
4. Copy `src/index.ts` (no changes needed — it's template-stable).
5. Copy `bin/fora-mcp-<name>.mjs` (rename, no other changes).
6. Copy `test/mock-<upstream>.mjs` and `test/smoke.mjs`, update routes and assertions.
7. Copy `README.md` and this `docs/template-note.md`.

The orchestrator agent picks the right toolset at runtime; it doesn't need to know which MCP server is providing them, only the tool names. That is the whole point of the template.

## Acceptance bar (also the template's)

A new MCP server is done when:

- All required tools are registered with Zod raw shapes and a one-line description per tool.
- `npm run smoke` exits 0 with the same end-of-log `[smoke] done: all N tools smoke-tested green`.
- README follows the same sections: Install, Authentication, Tools, Run the smoke test, Troubleshooting, Reuse.
- `docs/template-note.md` is updated to list the new server and any contract drift it requires.
- A `request_review` comment on the implementation issue links the smoke transcript and lists the manual verification step.

Anything less is a draft.
