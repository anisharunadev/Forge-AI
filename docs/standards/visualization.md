# Visualization Library Defaults

> Library choice for each visualization need. Pin your choice by adding to `docs/standards/tech-stack.md`.

| Need | Library | Status |
|---|---|---|
| Workflow / architecture diagrams | `@xyflow/react` (formerly react-flow) | In package.json |
| Knowledge graphs | `react-force-graph-2d` | **Planned** — install before use, or fall back to SVG/D3 |
| Analytics charts | `Recharts` | In package.json |
| Virtual lists | `@tanstack/react-virtual` | In package.json |
| Tables | `@tanstack/react-table` | In package.json |
| Drag-drop | `@dnd-kit/core` + `@dnd-kit/sortable` | In package.json |
| Markdown editor | `@uiw/react-md-editor` | In package.json |
| Terminal | `xterm.js` + WebLinksAddon + FitAddon | In package.json |
| Toasts | `sonner` | In package.json |
| Onboarding tours | `react-joyride` (planned) or driver.js fallback | **Planned** — current implementation is custom |

## Traceability requirement

Users must be able to trace:

```text
Requirement
 → ADR
 → Task
 → Code
 → Test
 → Deployment
```

end-to-end, across all visualizations. If a viz can't surface this chain, it isn't done.
