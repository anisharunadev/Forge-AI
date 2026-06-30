# MCP Tooling — Next.js Devtools

> Project-local MCP config and debugging workflow.

## Server registration

A project-local `.mcp.json` at the repo root configures **`next-devtools-mcp`**. It exposes live application state to coding agents when the Next.js dev server is running.

```json
// .mcp.json (project root — NOT global)
{
  "mcpServers": {
    "next-devtools": {
      "command": "npx",
      "args": ["-y", "next-devtools-mcp@latest"]
    }
  }
}
```

## When debugging is required

Before falling back to filesystem greps or manual reproduction for any `apps/forge` issue, prefer the MCP tools. They query the running dev server directly.

| Tool | Use it for |
|---|---|
| `get_errors` | Build errors, runtime errors, TypeScript errors |
| `get_logs` | Dev log file (browser console + server output) |
| `get_page_metadata` | Routes, components, and rendering details |
| `get_project_metadata` | Project structure + running dev server URL |
| `get_routes` | Entry-point routes (dynamic segments preserved) |
| `get_server_action_by_id` | Resolve a Server Action ID → file/function |

## Workflow

1. Confirm the Next.js dev server is running.
2. Call `get_errors` first when investigating a reported bug.
3. Use `get_routes` + `get_page_metadata` to confirm where a page actually renders.
4. Cross-check static analysis against `get_errors`.
5. Only fall back to `Read`/`Grep`/`Bash` when the MCP query returns nothing useful.

## Compatibility

`next-devtools-mcp` officially requires **Next.js 16+**. `apps/forge` is on **16.2.x**, so MCP capabilities are fully available.

## Scope rules

- This MCP server is **project-local only**. Do not register it in user-global MCP config.
- Do not add additional MCP servers to `.mcp.json` without an explicit ADR.

## Other MCP servers (mcp-servers/)

Sixteen additional MCP servers live under `mcp-servers/` (github, jira, figma, aws, slack, kiro, sonarqube, databricks, etc.). These are **NOT** registered in `.mcp.json` — they are runtime adapters invoked by agents, not developer tooling. Do not add them to `.mcp.json` without an ADR.
