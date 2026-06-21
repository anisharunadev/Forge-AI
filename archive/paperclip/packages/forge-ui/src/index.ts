/**
 * @fora/forge-ui — public surface for FORA-393 Plan 4 (renderer layer).
 *
 * Consumers import from "@fora/forge-ui" (this file) or per-subpath:
 *   - "@fora/forge-ui/tokens"        — brand tokens, theme, conventions (Plan 3)
 *   - "@fora/forge-ui/primitives"    — Shadcn-wrapped UI primitives
 *   - "@fora/forge-ui/a11y"          — focus / live-region / skip-link helpers
 *   - "@fora/forge-ui/typed-artifacts" — the ten typed-artifact renderers
 *   - "@fora/forge-ui/shell"         — top bar, left rail, canvas, right panel
 *   - "@fora/forge-ui/forms"         — RHF + Zod wrappers (useTypedForm, etc.)
 *   - "@fora/forge-ui/charts"        — Recharts wrappers with table fallbacks
 *   - "@fora/forge-ui/tree"          — generic / OrgTree / FileTree
 *   - "@fora/forge-ui/lists"         — TypedTable<T> + toolbar + empty state
 *   - "@fora/forge-ui/testing"       — renderWithProviders, axe helper
 *   - "@fora/forge-ui/audit"         — Audit Center (composer + query + saved queries)
 *
 * Subpaths keep bundle size tight. A center that only needs Button + tokens
 * should not pull the chart or graph tree-shaking surface.
 */
export * as Tokens from "./tokens";
export * as Primitives from "./primitives";
export * as A11y from "./a11y";
export * as TypedArtifacts from "./typed-artifacts";
export * as Shell from "./shell";
export * as Forms from "./forms";
export * as Charts from "./charts";
export * as Tree from "./tree";
export * as Lists from "./lists";
export * as Graph from "./graph";
export * as Audit from "./audit";
