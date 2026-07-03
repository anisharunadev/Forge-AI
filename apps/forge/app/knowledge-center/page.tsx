'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { useGraphShortcuts } from '@/components/knowledge-graph/use-graph-shortcuts';
import { GraphHeader, type GraphLayout, type ViewMode } from '@/components/knowledge-graph/GraphHeader';
import { NodeKindFilterBar } from '@/components/knowledge-graph/NodeKindFilterBar';
import { KnowledgeGraphCanvas } from '@/components/knowledge-graph/KnowledgeGraphCanvas';
import { NodeInspectorPanel } from '@/components/knowledge-graph/NodeInspectorPanel';
import { FiltersDrawer, type FiltersState, type TimeRange } from '@/components/knowledge-graph/FiltersDrawer';
import { IngestSourceModal, type IngestSourceKind } from '@/components/knowledge-graph/IngestSourceModal';
import { GraphEmptyState } from '@/components/knowledge-graph/GraphEmptyState';
import { GraphListView } from '@/components/knowledge-graph/GraphListView';
import { GraphOutlineView } from '@/components/knowledge-graph/GraphOutlineView';
import { GraphStatsStrip } from '@/components/knowledge-graph/GraphStatsStrip';
import { ALL_KINDS, ALL_EDGE_KINDS } from '@/components/knowledge-graph/graph-palette';
import {
  type NodeKind,
  type SampleEdge,
  type SampleNode,
} from '@/src/data/sample-graph';
import {
  useKGNodes,
  useKGEdges,
  useKGStats,
} from '@/lib/hooks/useKnowledgeGraph';
import { adapter } from '@/lib/knowledge-graph/adapter';
import { Loader2 } from 'lucide-react';

// ---- Static layout cycle used by the 'L' shortcut ----------------------------

const LAYOUT_CYCLE: ReadonlyArray<GraphLayout> = ['force', 'tb', 'lr', 'radial', 'grid', 'timeline'];

export default function KnowledgeCenterPage() {
  // ---- Data ---------------------------------------------------------------
  // Step 67: the page reads exclusively from the real backend via TanStack
  // Query hooks (`useKGNodes`, `useKGEdges`, `useKGStats`). The adapter
  // bridges the wire's KGNode/KGEdge shape onto the canvas's SampleNode
  // shape. No offline fixture — empty backend → <GraphEmptyState/>.
  const nodesQuery = useKGNodes();
  const edgesQuery = useKGEdges();
  useKGStats(); // warms the cache; rendered by <GraphStatsStrip/> below

  const nodesLoading = nodesQuery.isLoading || edgesQuery.isLoading;

  // Backend data, mapped through the adapter. Empty arrays until the
  // first response lands — <GraphEmptyState/> handles the empty render.
  const nodes: ReadonlyArray<SampleNode> = React.useMemo(() => {
    if (nodesQuery.data) return nodesQuery.data.map(adapter.toSampleNode);
    return [];
  }, [nodesQuery.data]);

  const edges: ReadonlyArray<SampleEdge> = React.useMemo(() => {
    if (edgesQuery.data) return edgesQuery.data.map(adapter.toSampleEdge);
    return [];
  }, [edgesQuery.data]);

  // ---- State --------------------------------------------------------------
  const [search, setSearch] = React.useState('');
  const [layout, setLayout] = React.useState<GraphLayout>('force');
  const [viewMode, setViewMode] = React.useState<ViewMode>('graph');
  const [visibleKinds, setVisibleKinds] = React.useState<ReadonlyArray<NodeKind>>(ALL_KINDS);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [localActive, setLocalActive] = React.useState(false);
  const [localHops, setLocalHops] = React.useState(2);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [ingestOpen, setIngestOpen] = React.useState(false);

  const [filters, setFilters] = React.useState<FiltersState>({
    visibleKinds: ALL_KINDS,
    hiddenEdgeKinds: [],
    timeRange: 'all',
    authors: [],
    tags: [],
    hideIsolated: false,
  });

  const router = useRouter();
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // ---- Derived lookups ---------------------------------------------------

  const allAuthors = React.useMemo(
    () => Array.from(new Set(nodes.map((n) => n.author.name))).sort(),
    [nodes],
  );
  const allTags = React.useMemo(
    () => Array.from(new Set(nodes.flatMap((n) => n.tags))).sort(),
    [nodes],
  );
  const kindCounts = React.useMemo(() => {
    const counts: Record<NodeKind, number> = {} as Record<NodeKind, number>;
    ALL_KINDS.forEach((k) => (counts[k] = 0));
    nodes.forEach((n) => {
      counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    });
    return counts;
  }, [nodes]);

  const nodeById = React.useMemo(() => {
    const m = new Map<string, SampleNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // Apply filters → final node/edge lists rendered to the canvas.
  const filteredNodes = React.useMemo(() => {
    const kindSet = new Set(filters.visibleKinds);
    const now = Date.now();
    const cutoff =
      filters.timeRange === 'all'
        ? 0
        : now - ({ '7d': 7, '30d': 30, '90d': 90 }[filters.timeRange] as number) * 86_400_000;
    const authorSet = new Set(filters.authors);
    const tagSet = new Set(filters.tags);

    const degreeById = new Map<string, number>();
    edges.forEach((e) => {
      degreeById.set(e.source, (degreeById.get(e.source) ?? 0) + 1);
      degreeById.set(e.target, (degreeById.get(e.target) ?? 0) + 1);
    });

    return nodes.filter((n) => {
      if (!kindSet.has(n.kind)) return false;
      if (cutoff > 0 && new Date(n.updatedAt).getTime() < cutoff) return false;
      if (authorSet.size > 0 && !authorSet.has(n.author.name)) return false;
      if (tagSet.size > 0 && !n.tags.some((t) => tagSet.has(t))) return false;
      if (filters.hideIsolated && (degreeById.get(n.id) ?? 0) === 0) return false;
      return true;
    });
  }, [nodes, edges, filters]);

  const filteredEdges = React.useMemo(() => {
    const ids = new Set(filteredNodes.map((n) => n.id));
    const hiddenEdgeSet = new Set(filters.hiddenEdgeKinds);
    return edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target) && !hiddenEdgeSet.has(e.kind),
    );
  }, [edges, filteredNodes, filters.hiddenEdgeKinds]);

  // Search results — used for filtering the graph + for highlighting nodes.
  const searchMatches = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      filteredNodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            n.kind.toLowerCase().includes(q) ||
            n.preview.toLowerCase().includes(q),
        )
        .map((n) => n.id),
    );
  }, [search, filteredNodes]);

  // Apply search filter to the displayed set.
  const displayNodes = React.useMemo(() => {
    if (!searchMatches) return filteredNodes;
    return filteredNodes.filter((n) => searchMatches.has(n.id));
  }, [filteredNodes, searchMatches]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  // ---- Handlers ----------------------------------------------------------

  const toggleKind = (kind: NodeKind) => {
    setVisibleKinds((curr) => {
      const next = curr.includes(kind) ? curr.filter((k) => k !== kind) : [...curr, kind];
      // Mirror to filters so the drawer's chip stays in sync.
      setFilters((f) => ({ ...f, visibleKinds: next }));
      return next;
    });
  };

  const cycleLayout = () => {
    setLayout((curr) => {
      const idx = LAYOUT_CYCLE.indexOf(curr);
      const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length];
      return next ?? 'force';
    });
  };

  const cycleVisibleNode = (dir: 1 | -1) => {
    const ids = displayNodes.map((n) => n.id);
    if (ids.length === 0) return;
    const idx = selectedId ? ids.indexOf(selectedId) : -1;
    const nextIdx = idx === -1 ? (dir === 1 ? 0 : ids.length - 1) : (idx + dir + ids.length) % ids.length;
    const next = ids[nextIdx];
    if (next) setSelectedId(next);
  };

  const jumpToKind = (kindIndex: number) => {
    const k = ALL_KINDS[kindIndex];
    if (!k) return;
    // Find the first node of that kind and select it.
    const target = displayNodes.find((n) => n.kind === k);
    if (target) setSelectedId(target.id);
  };

  const onNavigate = (n: SampleNode) => router.push(n.href);
  const onFindSimilar = (n: SampleNode) => router.push(`/search?q=${encodeURIComponent(n.label)}`);
  const onAddRelationship = (n: SampleNode) => router.push(`/graph/edit?from=${n.id}`);
  const onCopyLink = (n: SampleNode) => {
    if (typeof navigator !== 'undefined' && 'clipboard' in navigator) {
      navigator.clipboard.writeText(`${window.location.origin}${n.href}`);
    }
  };
  const onHide = (n: SampleNode) => {
    setVisibleKinds((curr) => curr.filter((k) => k !== n.kind));
  };
  const onPin = (_n: SampleNode) => {
    // The canvas already supports drag-to-pin; this is a no-op alias
    // that the menu calls. The user can still drag freely.
  };

  // Filter badge count = number of non-default filter sections active.
  const filterCount = React.useMemo(() => {
    let c = 0;
    if (filters.hiddenEdgeKinds.length > 0) c += 1;
    if (filters.timeRange !== 'all') c += 1;
    if (filters.authors.length > 0) c += 1;
    if (filters.tags.length > 0) c += 1;
    if (filters.hideIsolated) c += 1;
    return c;
  }, [filters]);

  const exportGraph = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      nodes: displayNodes,
      edges: filteredEdges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-knowledge-graph-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openIngest = () => setIngestOpen(true);
  const onIngestStart = (_kind: IngestSourceKind, _payload: Record<string, string>) => {
    // Backend stub — the modal simulates progress in its own state.
  };

  // ---- Keyboard shortcuts ------------------------------------------------

  useGraphShortcuts({
    searchInputRef,
    setLayout,
    layout,
    viewMode,
    setViewMode,
    clearSelection: () => setSelectedId(null),
    cycleLayout,
    cycleVisibleNode,
    openIngest,
    exportGraph,
    jumpToKind,
    kinds: ALL_KINDS,
  });

  // ---- Render ------------------------------------------------------------

  return (
    <AdminShell>
      <div className="flex flex-col gap-4" data-testid="knowledge-center-page">
        <GraphHeader
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={() => {
            // Pick the first search match and select it.
            if (searchMatches && searchMatches.size > 0) {
              const first = displayNodes.find((n) => searchMatches.has(n.id));
              if (first) setSelectedId(first.id);
            }
          }}
          layout={layout}
          onLayoutChange={setLayout}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          localActive={localActive}
          onToggleLocal={() => setLocalActive((v) => !v)}
          localHops={localHops}
          onLocalHopsChange={setLocalHops}
          filterCount={filterCount}
          onOpenFilters={() => setFiltersOpen(true)}
          onOpenIngest={openIngest}
          totalNodes={displayNodes.length}
          totalEdges={filteredEdges.length}
          searchInputRef={searchInputRef}
        />

        <NodeKindFilterBar
          visibleKinds={visibleKinds}
          onToggle={toggleKind}
          counts={kindCounts}
        />

        <GraphStatsStrip />

        {/* Canvas + (optional) inspector side-by-side */}
        <div
          className={
            selectedNode
              ? 'grid grid-cols-1 gap-4 lg:grid-cols-[1fr_440px] xl:grid-cols-[1fr_480px]'
              : 'grid grid-cols-1'
          }
          style={{ minHeight: 560 }}
        >
          <div className="relative">
            {/* Step 57 zone 3: skeleton while the orchestrator fetches nodes
                + edges. Only shown on the FIRST load — subsequent loads
                keep the previous render in place to avoid layout pop. */}
            {nodesLoading && !nodesQuery.data && !edgesQuery.data ? (
              <GraphSkeleton />
            ) : displayNodes.length === 0 && nodes.length === 0 ? (
              <GraphEmptyState
                onIngest={openIngest}
                onImport={openIngest}
                onAuto={openIngest}
              />
            ) : displayNodes.length === 0 ? (
              /* Filtered-to-zero state — still show GraphEmptyState as the
                 base layer so the canvas background isn't bare. */
              <GraphEmptyState
                onIngest={openIngest}
                onImport={openIngest}
                onAuto={openIngest}
              />
            ) : viewMode === 'graph' ? (
              <KnowledgeGraphCanvas
                nodes={displayNodes}
                edges={filteredEdges}
                visibleKinds={visibleKinds}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpen={onNavigate}
                layout={layout}
                localActive={localActive}
                localHops={localHops}
                hiddenEdgeKinds={filters.hiddenEdgeKinds}
              />
            ) : viewMode === 'list' ? (
              <GraphListView
                nodes={displayNodes}
                edges={filteredEdges}
                onPick={(n) => setSelectedId(n.id)}
                selectedId={selectedId}
                search={search}
              />
            ) : (
              <GraphOutlineView
                nodes={displayNodes}
                onPick={(n) => setSelectedId(n.id)}
                selectedId={selectedId}
              />
            )}

            {/* Inline empty-result message when filters return zero. */}
            {displayNodes.length === 0 && nodes.length > 0 && !nodesLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-[var(--bg-base)]/85 backdrop-blur-sm">
                <p className="text-sm text-[var(--fg-secondary)]">No nodes match these filters.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleKinds(ALL_KINDS);
                      setFilters({
                        visibleKinds: ALL_KINDS,
                        hiddenEdgeKinds: [],
                        timeRange: 'all',
                        authors: [],
                        tags: [],
                        hideIsolated: false,
                      });
                    }}
                    className="inline-flex h-8 items-center rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-3 text-xs font-medium text-white hover:opacity-90"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedNode && (
            <NodeInspectorPanel
              node={selectedNode}
              edges={filteredEdges}
              allNodes={nodes}
              onClose={() => setSelectedId(null)}
              onNavigate={onNavigate}
              onFindSimilar={onFindSimilar}
              onAddRelationship={onAddRelationship}
              onCopyLink={onCopyLink}
              onHide={onHide}
              onPin={onPin}
            />
          )}
        </div>

        <FiltersDrawer
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          state={filters}
          onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
          counts={kindCounts}
          authors={allAuthors}
          tags={allTags}
          onReset={() =>
            setFilters({
              visibleKinds: ALL_KINDS,
              hiddenEdgeKinds: [],
              timeRange: 'all',
              authors: [],
              tags: [],
              hideIsolated: false,
            })
          }
          onApply={() => setVisibleKinds(filters.visibleKinds)}
        />

        <IngestSourceModal
          open={ingestOpen}
          onOpenChange={setIngestOpen}
          onIngest={onIngestStart}
        />
      </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Inline loading skeleton (Step 57 zone 3)
//
// Shown while the first /kg/nodes + /kg/edges fetch is in flight. Mirrors
// the canvas frame's rounded card + min-height so the layout doesn't
// shift when the real canvas swaps in.
// ---------------------------------------------------------------------------

function GraphSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading knowledge graph"
      data-testid="knowledge-graph-skeleton"
      className="relative flex h-full min-h-[480px] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-base)]"
    >
      {/* Faux galaxy backdrop — keeps the visual continuity with the real
          canvas so the transition to the live view is seamless. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 18% 22%, rgba(34, 211, 238, 0.06) 0%, transparent 45%)',
            'radial-gradient(circle at 82% 78%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
            'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.03) 0%, transparent 60%)',
          ].join(', '),
        }}
      />

      {/* Three pulsing dots — the established loading affordance in the
          canvas's "Graph is rendering…" message, kept consistent here. */}
      <div className="relative flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-primary)]"
          style={{ animationDelay: '0ms' }}
        />
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-cyan)]"
          style={{ animationDelay: '150ms' }}
        />
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-violet)]"
          style={{ animationDelay: '300ms' }}
        />
      </div>

      <div className="relative flex flex-col items-center gap-1.5 text-[var(--fg-tertiary)]">
        <Loader2
          className="h-5 w-5 animate-spin text-[var(--accent-primary)]"
          aria-hidden="true"
        />
        <p className="text-xs font-medium">Loading knowledge graph…</p>
        <p className="text-[11px] text-[var(--fg-muted)]">
          Fetching nodes, edges, and project intelligence
        </p>
      </div>
    </div>
  );
}