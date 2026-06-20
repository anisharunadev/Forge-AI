# @fora/forge-ui

FORA Forge UI — design system tokens, Shadcn-wrapped primitives, accessibility harness, and typed-artifact renderers per [FORA-393 Plan 3](../../workspace/plan/fora-393/03-design-system-spec.md) and [Plan 4](../../workspace/plan/fora-393/04-component-library-plan.md).

## Package layout

```
src/
├── tokens/          # CSS variables (brand, typography, icon) + conventions override
├── primitives/      # Shadcn-wrapped Button, Input, Select, Dialog, DropdownMenu, …
├── shell/           # top bar / left rail / main / right panel layout
├── typed-artifacts/ # the 8 typed-artifact renderers + AuditEntry + ApprovalRequest
├── a11y/            # focus-visible, skip-link, live-region helpers
├── charts/          # Recharts typed wrappers
├── forms/           # React Hook Form + Zod typed helpers
├── lists/           # TanStack Table wrappers
├── tree/            # generic + org + file tree
├── graph/           # React Flow canvas primitives (consumed by Plan 2)
├── testing/         # axe, renderWithProviders
└── styles.css       # Tailwind base + KnackForge brand tokens
```

## Usage

```tsx
import { Button, ThemeProvider } from "@fora/forge-ui";
import "@fora/forge-ui/styles.css";

export default function App() {
  return (
    <ThemeProvider persona="pm">
      <Button variant="primary">Ship</Button>
    </ThemeProvider>
  );
}
```

## Acceptance criteria (FORA-393-F1)

- `pnpm --filter @fora/forge-ui build` green.
- `pnpm --filter @fora/forge-ui test` green.
- axe-core CI job green on the demo route.
- Lighthouse accessibility score ≥ 95 on the demo route.
- Storybook deferred to v1.1.

See [FORA-482](/FORA/issues/FORA-482).