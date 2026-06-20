/**
 * DevelopmentCenter — Plan 1 §3.7 v1.0 GA composer.
 *
 * Ties together the nine scope items:
 *   1. ADR list (compact + detail)
 *   2. In-flight Patches (PatchRenderer)
 *   3. PR queue (compact-list-row)
 *   4. Architecture Graph canvas (slate-2, embedded; uses the existing
 *      `ArchitectureGraphCanvas` from `@fora/forge-ui/graph`)
 *   5. Dependency Graph canvas (slate-2, embedded; uses the existing
 *      `DependencyGraphCanvas`)
 *   6. Blast-radius mode (multi-select on Dependency Graph)
 *   7. Cycle explainer panel
 *   8. Filter by ADR status / owner / package / no-tests / text
 *   9. "Show in graph" affordance from any ADR / Patch / Component
 *
 * The composer owns the local UI state (active canvas, selection, filter,
 * cycle explainer). Tenancy is enforced upstream by the host (a
 * `TenantScopedAuditFetcher`-shaped boundary per the audit pattern).
 *
 * The graph canvases are imported as `React.lazy` so a consumer that
 * only needs the list views (e.g. a sidebar) doesn't pay the React Flow
 * bundle cost. The graph subpath is a peer of the development subpath.
 */

import { Suspense, lazy, useCallback, useMemo, useState, type JSX } from "react";
import { ArchitectureGraphCanvas, DependencyGraphCanvas } from "../graph";
import type { ArchitectureGraphProvider, DependencyGraphProvider } from "../graph";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import { cn } from "../tokens/cn";
import { AdrList } from "./adr-list";
import { BlastRadiusPanel } from "./blast-radius-panel";
import { CycleExplainerPanel } from "./cycle-explainer-panel";
import type {
  AdrRegistryEntry,
  DependencyCycle,
  DevelopmentFilter,
  GraphTarget,
  PrReviewRecord,
} from "./development";
import { DevelopmentFilters, applyAdrFilter } from "./development-filters";
import { InFlightPatches } from "./in-flight-patches";
import { PrQueue } from "./pr-queue";
import type { Patch } from "../typed-artifacts/types";

// Lazy graph mounts — the canvas components are heavy (React Flow + dagre)
// and most side-panel use cases only need the lists.
const LazyArchitectureCanvas = lazy(() =>
  import("../graph").then((m) => ({ default: m.ArchitectureGraphCanvas })),
);
const LazyDependencyCanvas = lazy(() =>
  import("../graph").then((m) => ({ default: m.DependencyGraphCanvas })),
);

const ADR_FIXTURE: ReadonlyArray<AdrRegistryEntry> = [
  {
    number: "0001",
    title: "Adopt typed graph provider",
    path: "docs/adr/0001-typed-graph-provider.md",
    status: "accepted",
    date: "2026-06-17",
    architectureArea: "knowledge-layer",
  },
  {
    number: "0002",
    title: "Forge UI subpath split",
    path: "docs/adr/0002-forge-ui-subpaths.md",
    status: "accepted",
    date: "2026-06-18",
    architectureArea: "ui",
  },
  {
    number: "0003",
    title: "MCP scoped credentials by default",
    path: "docs/adr/0003-mcp-scoped-creds.md",
    status: "proposed",
    date: "2026-06-20",
    architectureArea: "security",
  },
];

const PATCH_FIXTURE: ReadonlyArray<Patch> = [
  {
    id: "patch-1",
    title: "Add typed GraphProvider contract",
    summary: "Plan 2 §5 typed graph provider — single source of truth for the four canvases.",
    additions: 320,
    deletions: 12,
    filesChanged: 5,
    files: [
      { path: "packages/forge-ui/src/graph/provider.ts", additions: 280, deletions: 10, hunks: [] },
      { path: "packages/forge-ui/src/graph/cache.ts", additions: 40, deletions: 2, hunks: [] },
    ],
    testFilesExercised: ["provider.test.ts", "graph-text-list.test.tsx"],
    linkedPrs: [{ id: "101", url: "https://github.com/fora/pr/101", state: "open" }],
  },
];

const PR_FIXTURE: ReadonlyArray<PrReviewRecord> = [
  {
    id: "pr-101",
    prNumber: "101",
    url: "https://github.com/fora/pr/101",
    title: "Add typed GraphProvider contract",
    author: { displayName: "Senior Engineer", id: "27431e10-478f-45da-a058-92770d404b53" },
    state: "open",
    reviewState: "commented",
    linesAdded: 320,
    linesDeleted: 12,
    filesChanged: 5,
    updatedAt: "2026-06-20T12:00:00Z",
    storyId: "FORA-393",
    patchId: "patch-1",
  },
];

const CYCLE_FIXTURE: ReadonlyArray<DependencyCycle> = [
  {
    id: "cycle-1",
    modules: ["packages/forge-ui/src/development/adr-list.tsx", "packages/forge-ui/src/typed-artifacts/adr.tsx", "packages/forge-ui/src/development/adr-list.tsx"],
    reason: "adr-list imports adr renderer, which imports the registry entry type from adr-list",
  },
];

export type DevCanvas = "architecture" | "dependency";

export interface DevelopmentCenterProps {
  readonly adrs?: ReadonlyArray<AdrRegistryEntry>;
  readonly patches?: ReadonlyArray<Patch>;
  readonly pullRequests?: ReadonlyArray<PrReviewRecord>;
  readonly cycles?: ReadonlyArray<DependencyCycle>;
  readonly architectureProvider?: ArchitectureGraphProvider | null;
  readonly dependencyProvider?: DependencyGraphProvider | null;
  readonly onNavigate?: (target: GraphTarget) => void;
  readonly onSelectModules?: (moduleIds: ReadonlyArray<string>) => void;
  readonly selectedModuleIds?: ReadonlyArray<string>;
  readonly className?: string;
}

export function DevelopmentCenter({
  adrs = ADR_FIXTURE,
  patches = PATCH_FIXTURE,
  pullRequests = PR_FIXTURE,
  cycles = CYCLE_FIXTURE,
  architectureProvider = null,
  dependencyProvider = null,
  onNavigate,
  onSelectModules,
  selectedModuleIds = [],
  className,
}: DevelopmentCenterProps): JSX.Element {
  const [filter, setFilter] = useState<DevelopmentFilter>({});
  const [activeCanvas, setActiveCanvas] = useState<DevCanvas>("dependency");
  const [activeCycleId, setActiveCycleId] = useState<string | null>(null);

  const filteredAdrs = useMemo(() => applyAdrFilter(adrs, filter), [adrs, filter]);
  const activeCycle = useMemo(
    () => cycles.find((c) => c.id === activeCycleId) ?? null,
    [cycles, activeCycleId],
  );

  const handleReset = useCallback(() => setFilter({}), []);

  const handleModuleClick = useCallback(
    (id: string | null) => {
      if (id === null) {
        onSelectModules?.([]);
        return;
      }
      // Toggle selection.
      const next = selectedModuleIds.includes(id)
        ? selectedModuleIds.filter((x) => x !== id)
        : [...selectedModuleIds, id];
      onSelectModules?.(next);
    },
    [selectedModuleIds, onSelectModules],
  );

  return (
    <div
      data-testid="development-center"
      className={cn("grid grid-cols-1 gap-6 lg:grid-cols-12", className)}
    >
      <header className="lg:col-span-12">
        <p className="text-caption uppercase tracking-wider text-ink-muted">Center #4</p>
        <h1 className="text-display-2 font-semibold text-ink-default">Development Center</h1>
        <p className="mt-1 text-body text-ink-muted">
          Audit any ADR, follow any in-flight patch, blast-radius any module, and walk
          any cycle the dependency analyzer surfaces.
        </p>
      </header>

      <section className="lg:col-span-12" aria-label="Filters">
        <DevelopmentFilters
          value={filter}
          owners={[]}
          packages={[]}
          onChange={setFilter}
          onReset={handleReset}
        />
      </section>

      <section className="space-y-3 lg:col-span-7" aria-label="Graphs">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Graph canvases">
          <Button
            type="button"
            role="tab"
            aria-selected={activeCanvas === "architecture"}
            variant={activeCanvas === "architecture" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveCanvas("architecture")}
            data-testid="canvas-tab-architecture"
          >
            Architecture Graph
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={activeCanvas === "dependency"}
            variant={activeCanvas === "dependency" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveCanvas("dependency")}
            data-testid="canvas-tab-dependency"
          >
            Dependency Graph
          </Button>
          <Badge tone="neutral" data-testid="canvas-selected-count">
            {selectedModuleIds.length} selected
          </Badge>
        </div>

        <div
          data-testid={`canvas-host-${activeCanvas}`}
          className="rounded-md border border-surface-border bg-surface-raised"
          style={{ minHeight: 480 }}
        >
          {activeCanvas === "architecture" ? (
            architectureProvider ? (
              <Suspense fallback={<CanvasFallback label="Architecture Graph" />}>
                <LazyArchitectureCanvas
                  provider={architectureProvider}
                  onSelectNode={onNavigate ? (id) => onNavigate({ canvas: "architecture", nodeId: id ?? "" }) : undefined}
                />
              </Suspense>
            ) : (
              <CanvasFallback
                label="Architecture Graph"
                note="No provider supplied — pass an ArchitectureGraphProvider to render."
              />
            )
          ) : dependencyProvider ? (
            <Suspense fallback={<CanvasFallback label="Dependency Graph" />}>
              <LazyDependencyCanvas
                provider={dependencyProvider}
                onSelectNode={handleModuleClick}
              />
            </Suspense>
          ) : (
            <CanvasFallback
              label="Dependency Graph"
              note="No provider supplied — pass a DependencyGraphProvider to render."
            />
          )}
        </div>
      </section>

      <section className="space-y-4 lg:col-span-5" aria-label="Side panels">
        <BlastRadiusPanel
          sources={selectedModuleIds}
          nodes={[]}
          edges={[]}
          {...(onNavigate ? { onNavigate } : {})}
        />
        <CycleExplainerPanel
          cycle={activeCycle}
          onClose={() => setActiveCycleId(null)}
          {...(onNavigate ? { onNavigateToGraph: onNavigate } : {})}
        />
        {cycles.length > 0 && (
          <div className="rounded-md border border-surface-border bg-surface p-3">
            <p className="text-caption uppercase tracking-wider text-ink-muted">
              Detected cycles
            </p>
            <ul className="mt-2 space-y-1">
              {cycles.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveCycleId(c.id)}
                    aria-pressed={activeCycleId === c.id}
                    data-testid={`cycle-button-${c.id}`}
                    className={cn(
                      "w-full rounded-sm border px-2 py-1 text-left text-body-sm",
                      activeCycleId === c.id
                        ? "border-brand-danger bg-brand-danger/10 text-ink-default"
                        : "border-surface-border bg-surface text-ink-muted hover:bg-surface-sunken",
                    )}
                  >
                    {c.id} <span className="text-caption text-ink-subtle">· {c.modules.length} modules</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 lg:col-span-7" aria-label="Architecture Decision Records">
        <header className="flex items-baseline justify-between">
          <h2 className="text-heading-1 font-semibold text-ink-default">Architecture Decision Records</h2>
          <p className="text-caption text-ink-muted">
            {filteredAdrs.length} of {adrs.length}
          </p>
        </header>
        <AdrList entries={filteredAdrs} variant="detail" {...(onNavigate ? { onNavigate } : {})} />
      </section>

      <section className="space-y-3 lg:col-span-5" aria-label="In-flight patches">
        <header className="flex items-baseline justify-between">
          <h2 className="text-heading-1 font-semibold text-ink-default">In-flight patches</h2>
          <p className="text-caption text-ink-muted">{patches.length} open</p>
        </header>
        <InFlightPatches patches={patches} {...(onNavigate ? { onNavigate } : {})} />
      </section>

      <section className="space-y-3 lg:col-span-12" aria-label="PR queue">
        <header className="flex items-baseline justify-between">
          <h2 className="text-heading-1 font-semibold text-ink-default">PR queue</h2>
          <p className="text-caption text-ink-muted">{pullRequests.length} open</p>
        </header>
        <PrQueue records={pullRequests} />
      </section>
    </div>
  );
}

function CanvasFallback({ label, note }: { label: string; note?: string }): JSX.Element {
  return (
    <div
      role="status"
      data-testid={`canvas-fallback-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="flex h-full min-h-[480px] flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p className="text-body-sm font-medium text-ink-muted">{label}</p>
      {note ? <p className="text-caption text-ink-subtle">{note}</p> : null}
    </div>
  );
}

/** Re-exported for the public surface. */
export type { ArchitectureGraphProvider, DependencyGraphProvider } from "../graph";
