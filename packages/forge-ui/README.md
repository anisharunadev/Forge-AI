# @fora/forge-ui

FORA Forge UI — design system tokens, Shadcn-wrapped primitives, accessibility harness, typed-artifact renderers, shell, form/chart/table/tree helpers, and typed graph canvases per [FORA-393 Plan 3](../../workspace/plan/fora-393/03-design-system-spec.md), [Plan 4](../../workspace/plan/fora-393/04-component-library-plan.md), and [Plan 2](../../workspace/plan/fora-393/02-graph-canvas-spec.md).

## Package layout

```
src/
├── tokens/          # CSS variables (brand, typography, icon) + conventions override
├── primitives/      # Shadcn-wrapped Button, Input, Select, Dialog, DropdownMenu, …
├── shell/           # top bar / left rail / main / right panel layout
├── typed-artifacts/ # the 10 typed-artifact renderers (Plan 4 §3)
├── a11y/            # focus-visible, skip-link, live-region helpers
├── charts/          # Recharts typed wrappers + Sparkline (Plan 4 §5)
├── forms/           # React Hook Form + Zod typed helpers (Plan 4 §4)
├── lists/           # TanStack Table wrappers (Plan 4 §7)
├── tree/            # generic + org + file tree (Plan 4 §6)
├── graph/           # React Flow typed graph provider + 4 canvases (Plan 2)
├── testing/         # axe, renderWithProviders
└── styles.css       # Tailwind base + FORA brand tokens
```

## v0.2.0 changelog (FORA-393-F3)

- **10 typed-artifact renderers** (`@fora/forge-ui/typed-artifacts`): `RequirementRenderer`, `AdrRenderer`, `ApiContractRenderer` (summary / detail / diff), `TaskRenderer`, `PatchRenderer` (summary / diff / panel / pr-link), `TestReportRenderer` (summary-card / detail-panel / coverage-map), `SecurityReportRenderer`, `DeploymentPlanRenderer`, `AuditEntryRenderer` (row / panel), `ApprovalRequestRenderer` (panel / inline-banner).
- **Shell** (`@fora/forge-ui/shell`): top bar (TenantBadge, PersonaSwitcher, GlobalSearch, NotificationBell, BudgetMeter), left rail, main canvas, right panel, status bar.
- **Forms** (`@fora/forge-ui/forms`): `useTypedForm<TSchema>` (RHF + Zod), `TypedFormField`, `TypedFormSection`.
- **Charts** (`@fora/forge-ui/charts`): `LineChart`, `BarChart`, `StackedAreaChart`, `Heatmap`, `Sparkline` — each with an accessible `<details>` table fallback.
- **Tree** (`@fora/forge-ui/tree`): `Tree<T>`, `OrgTree`, `FileTree` — keyboard-navigable, role="tree".
- **Lists** (`@fora/forge-ui/lists`): `TypedTable<T>`, `TypedTableToolbar`, `TypedTableEmptyState`, `toCsv` helper.
- New dependencies: `@tanstack/react-table ^8.20.5`, `recharts ^2.13.0`.

## Usage

```tsx
import { Button, ThemeProvider } from "@fora/forge-ui";
import { TestReportRenderer } from "@fora/forge-ui/typed-artifacts";
import { TypedTable } from "@fora/forge-ui/lists";
import "@fora/forge-ui/styles.css";

export default function App() {
  return (
    <ThemeProvider persona="pm">
      <Button variant="primary">Ship</Button>
      <TestReportRenderer artifact={{ id: "tr-1", tier: "unit", total: 100, passed: 96, failed: 2, skipped: 2, durationMs: 4300 }} />
      <TypedTable data={[]} columns={[]} ariaLabel="Tasks" />
    </ThemeProvider>
  );
}
```

## Graph module (FORA-393-F2 / FORA-508)

`@fora/forge-ui/graph` ships the four React Flow canvases Plan 2 names
(Knowledge, Architecture, Dependency, Audit Timeline). Each canvas is
backed by a typed `GraphProvider<N, E>` and a typed node palette.

```tsx
import {
  KnowledgeGraphProvider,
  KnowledgeGraphCanvas,
  InMemoryKnowledgeFetcher,
} from "@fora/forge-ui/graph";

const fetcher = new InMemoryKnowledgeFetcher({
  files: [
    { id: "f1", family: "knowledge", kind: "knowledge_file", label: "memory/x.md", folder: "memory" },
  ],
  edges: [],
});
const provider = new KnowledgeGraphProvider(fetcher);

export default function KnowledgeCenter() {
  return <KnowledgeGraphCanvas provider={provider} onSelectNode={(id) => console.log(id)} />;
}
```

### Four canvases

- `KnowledgeGraphCanvas` — Knowledge Center, LR layout, 5-min cache + eager-invalidate.
- `ArchitectureGraphCanvas` — Project Intelligence, LR layout, 1-min cache + ADR-transition invalidate.
- `DependencyGraphCanvas` — Development Center, TB layout, 15-min cache + edge aggregation beyond 500.
- `AuditTimelineGraphCanvas` — Audit Center, LR + time x-axis, 5s polling (SSE bridge in v1.1).

### Cross-canvas rules (Plan 2 §4)

- `role="application"` wrapper + accessible name on every canvas.
- Skip-to-list link + text-equivalent list view (screen-reader default).
- Keyboard nav: `Cmd/Ctrl+K` opens the node picker; selection pins to URL hash.
- Virtualization (`onlyRenderVisibleElements`) when nodes ≥ 200.
- Edge aggregation in the Dependency provider when edges > 500.

### Tests (FORA-393-F2 ACs)

- `pnpm --filter @fora/forge-ui test` — graph-specific unit + render tests (providers, layout, text list, canvas shells).
- `pnpm --filter @fora/forge-ui test:a11y` — axe-core WCAG 2 A green on all four canvases.
- `pnpm --filter @fora/forge-ui lint:a11y` — Playwright keyboard nav (role=application, Cmd/Ctrl+K).

## Acceptance criteria (FORA-393-F1 / F3)

- `pnpm --filter @fora/forge-ui build` green.
- `pnpm --filter @fora/forge-ui test` green (110 tests covering renderers + shell + forms + charts + tree + lists).
- TypedTable handles 10k rows in < 100ms in browser (Playwright AC #6 — jsdom harness uses 2500ms threshold).
- axe-core CI job green on the demo route.
- Lighthouse accessibility score ≥ 95 on the demo route.
- Storybook deferred to v1.1.

See [FORA-482](/FORA/issues/FORA-482) (F1), [FORA-508](/FORA/issues/FORA-508) (F2), and [FORA-509](/FORA/issues/FORA-509) (F3).
