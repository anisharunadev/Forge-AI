# `forge-ai-mcp-adobe-xd` — Forge AI Adobe XD MCP Server

Priority-2 MCP server for the Forge AI Enterprise AI SDLC Operating System.
Exposes four tools over MCP/stdio per F-509:

- `get_asset(asset_id)`
- `list_components(file_id)`
- `export_spec(file_id, format)`
- `get_design_tokens(file_id)`

The server is **pinned to a single Adobe XD file and project** at startup.
The model can pass asset IDs, but the file/project scope is asserted on
startup with a single liveness call. This is the same safety property the
Figma MCP server enforces (file-pinned + team-pinned), adapted one level
to Adobe's Creative Cloud model.

---

## Status — SCAFFOLD, FLAGGED FOR REVIEW

> Adobe XD's public API surface is **evolving and not yet broadly documented**
> as a stable REST contract. This scaffold was built against Adobe's CC
> Asset / Creative SDK patterns (REST + OAuth2 bearer) and the publicly
> stated direction of the XD platform. **The endpoints and shapes here
> should be re-validated against Adobe's current docs before shipping
> production traffic.** See the "Review flag" section at the bottom of this
> document for the assumptions called out at scaffold time.

The structural contract (pin-on-startup, typed client wrapper, Zod raw
shapes, stdout=JSON-RPC / stderr=logs, mock-HTTP test, clean signal
handling, no agent-visible env vars beyond pin+token) is faithful to the
Figma MCP server template and is **not** in flux. Only the Adobe-XD-specific
URLs, auth header, and response shapes need verification.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/adobe-xd
pnpm install
pnpm run build
```

The compiled entry point is `dist/index.js`. The launcher at
`bin/adobe-xd-mcp` resolves it for you.

### Wire into an MCP client

```jsonc
{
  "mcpServers": {
    "adobe-xd": {
      "command": "adobe-xd-mcp",
      "env": {
        "ADOBE_XD_ACCESS_TOKEN": "${ADOBE_XD_ACCESS_TOKEN}",
        "ADOBE_XD_FILE_ID": "your-customer-xd-file-id",
        "ADOBE_XD_PROJECT_ID": "your-customer-cc-project-id"
      }
    }
  }
}
```

The server reads all three env vars on startup. If any is missing, it
exits with a non-zero status and a clear message naming the offending
variable.

---

## Authentication

The server uses OAuth2 via **Adobe Identity Management System (IMS)**,
per the F-016 connector contract. Adobe issues short-lived bearer tokens
after a refresh-token exchange; that exchange lives in the orchestrator
(not in this MCP server) so the server's hot path is one `fetch` call
per tool invocation.

The bearer token is sent as `Authorization: Bearer <token>` on every
outbound request. Adobe IMS also expects an `x-api-key` header alongside
the bearer; we forward the access token there as a placeholder and
recommend reviewing Adobe's current spec for the correct client-id value
(see "Review flag" below).

Token-least-privilege: scope the IMS integration to the smallest set of
XD files / Creative Cloud projects needed for the agent's workflow. Do
not grant org-wide design library access.

---

## Tools

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `get_asset` | Fetch a single design asset by id. | `asset_id` | — |
| `list_components` | List components in the pinned file. | — | `file_id` (forward-compat only — server always uses pinned file) |
| `export_spec` | Export a design spec (JSON / CSS / SCSS). | `format` (default `json`) | `file_id` |
| `get_design_tokens` | Extract colors, typography, spacing tokens. | — | `file_id` |

### Example payloads

`get_asset`:

```json
{ "asset_id": "asset-hero" }
```

`list_components`:

```json
{}
```

`export_spec`:

```json
{ "format": "json" }
```

`get_design_tokens`:

```json
{}
```

---

## Run the tests

The test suite contains **4 unit tests (one per tool)** and **2 integration
tests**, all backed by a mock HTTP client / mock HTTP server — no real
Adobe XD traffic is touched.

```bash
cd mcp-servers/adobe-xd
pnpm install
pnpm test
```

Expected output ends with a `node:test` summary showing all 6 tests
passing.

---

## Review flag — Adobe-XD-specific assumptions

These are the assumptions made at scaffold time that need verification
before this server is wired into a production design partner's workflow:

1. **Base URL.** Assumed `https://xd.adobe.io`. Confirm against Adobe's
   current XD API documentation.
2. **Endpoint shapes.** Assumed `/v1/files/{fileId}` for file metadata,
   `/v1/files/{fileId}/assets/{assetId}` for single assets,
   `/v1/files/{fileId}/components` for the component list,
   `/v1/files/{fileId}/spec?format=…` for spec export, and
   `/v1/files/{fileId}/tokens` for design tokens. Re-verify against
   Adobe's published spec.
3. **Auth headers.** Assumed `Authorization: Bearer <token>` and a
   paired `x-api-key` header. Adobe IMS typically requires the client-id
   (not the bearer) in `x-api-key`; the client currently forwards the
   bearer as a placeholder and should be updated once the correct
   client-id source is wired into the orchestrator config.
4. **Response shapes.** `Asset`, `Component`, `DesignTokens`, and
   `DesignSpec` TypeScript interfaces are reasonable scaffolds; expect
   field-level drift once Adobe's actual responses are sampled.
5. **`list_components` cap.** Assumed 100 components per call. Verify
   Adobe's server-side cap and adjust `MAX_COMPONENTS_PER_CALL`
   accordingly.
6. **Project-scope assertion.** The startup liveness call is a single
   `GET /v1/files/{fileId}`; if Adobe's API requires a different
   project-scope probe, swap it in `index.ts` and document the
   contract drift here.

When Adobe's XD API surface stabilizes, this review flag should be
removed from this README and the contract-drift section should record
the verified endpoints in their place.

---

## Reuse: the Forge AI MCP server template

This package is a copy of `mcp-servers/figma/` with three substitutions:

1. **Auth**: Figma PAT (`X-Figma-Token`) → Adobe IMS OAuth2 bearer
   (`Authorization: Bearer …`).
2. **Pins**: Figma's two-level pin (`FIGMA_FILE_KEY` + `FIGMA_TEAM_ID`)
   → Adobe's two-level pin (`ADOBE_XD_FILE_ID` + `ADOBE_XD_PROJECT_ID`).
3. **Tools**: Figma's six tools (`get_file`, `get_file_nodes`, `get_node`,
   `get_images`, `get_comments`, `post_comment`) → Adobe XD's four
   F-509 tools (`get_asset`, `list_components`, `export_spec`,
   `get_design_tokens`).

All seven shared contract points from `mcp-servers/figma/docs/template-note.md`
apply verbatim:

1. Single-scope pin on startup.
2. Typed client wrapper (`createClient(config)`).
3. Zod raw shapes as the source of truth.
4. stdout = JSON-RPC, stderr = logs.
5. Mock-HTTP test.
6. Clean SIGINT/SIGTERM.
7. No agent-visible env vars beyond the pin and the token.
