# Step 51 — Knowledge Center: Center-on-Load + Functional Minimap

## Files modified

- `apps/forge/components/knowledge-graph/force-simulation.ts`
- `apps/forge/components/knowledge-graph/KnowledgeGraphCanvas.tsx`

## Rationale (1 paragraph)

The Knowledge Center uses a custom Canvas-based force-directed layout
(not `react-force-graph-2d`), so the goal's react-force-graph snippets were
treated as guidance, not literal recipes. Per the `ux-guideline` domain
hits ("Show user location in site hierarchy" / "Fixed nav should not obscure
content" / "Sticky navigation" pattern), the rule is *the user's first view
must frame the content, not require a search*. For Bug 1, the root cause
wasn't the API call — it was the *condition* gating it. `fit()` was
guarded by `sim.alpha() < 0.1`, but `ALPHA_DECAY * 0.01 = 0.00018`/tick
plus a 4-second idle-pause meant the live loop only ever ran ~240 ticks
(alpha 1.0 → 0.957), so `fit()` *never fired*. Combined with the graph
being seeded across ±1200 graph units, the viewport at `zoom=1, pan=(0,0)`
projects the bottom-right quadrant of node-space onto the top-left of the
canvas. Fix: add a synchronous `warmup(N)` to the simulation, call it
after construction so positions settle before first paint, then fire
`fit()` unconditionally on the next rAF. Animate the fit with
`easeInOutCubic` over 400ms so the camera flies rather than snapping.
For Bug 2, the viewport indicator math was already correct — it just
showed an empty region because Bug 1 left `pan=(0,0)`. The actual missing
feature was click-to-pan: added an `onPan(graphX, graphY)` prop, inverse-
project the SVG pointer event through `getBoundingClientRect()` to graph
space, and compute `newPan = {size/2 - graph*zoom}`. Drag (while mouse
button held) continuously scrubs the main canvas for a tactile feel.
View code in `draw()`, hit-test (`findNodeAt`), and the drag handler
were converted from React-state to `useRef` mirrors so the rAF loop and
input handlers always read the *current* zoom/pan — critical because the
fit animation interpolates both ~24 frames.

## What we deliberately did NOT change

- **Right panel** (`NodeInspectorPanel`) — untouched, still shows selected
  node details, navigate / find-similar / copy-link actions.
- **Filters** (top kind chips, `FiltersDrawer`, time range, authors, tags,
  hide-isolated) — untouched. Filter changes still rebuild the simulation
  and re-fit (via `needsFit` in the build effect).
- **Search** (`GraphHeader` `search` field → highlight + filter) — untouched.
- **Zoom controls** (zoom out / percentage / zoom in / fit / labels toggle) —
  untouched. The percentage label still reads from React state (`zoom`),
  which is correct for a display value.
- **Force simulation algorithm** (charge / spring / collision / center /
  position / community detection, Louvain-style label propagation) — the
  tick math, alpha decay rate, damping, charge constant, rest length, and
  spread bounds are all unchanged. Only `warmup()` was added (it just calls
  the existing `tick()` N times and snaps alpha to `MIN_ALPHA`).
- **Data shape** (`SampleNode`, `SampleEdge`, the `SAMPLE_GRAPH` fixture) —
  untouched. Swapping in the real `/v1/knowledge-center/nodes` fetch stays
  a one-line change.
- **Layout cycle** (`force / tb / lr / radial / grid / timeline` via the `L`
  shortcut) — untouched. The `Layout override` effect still pins nodes
  per-layout and the `Fit-to-Viewport` button still re-fits.
- **Keyboard shortcuts** (`use-graph-shortcuts` — focus search, L cycle, V
  view-mode, arrows, etc.) — untouched.
- **Hover preview card**, stats overlay (top-left), bottom-right hint,
  galaxy background / star-field, community halos, smart labels, edge
  styling — untouched.

## Tests

- **Initial load**: graph is centered on first paint (not top-left).
  Reasoning: `sim.warmup(400)` runs synchronously after construction →
  positions are at force-equilibrium → `needsFit` is true → first rAF
  fires `fit()` → camera interpolates from `(0,0)` to the bbox center over
  400ms.
- **Pan the graph (drag a node)**: minimap viewport indicator follows.
  Reasoning: parent re-renders on every frame the canvas paints (because
  drag updates `sim.nodes[*].fx/fy`, which `draw()` reads each frame, but
  the minimap is also a React subtree that re-renders on `pan` state
  change via the parent); with `findNodeAt` using `zoomRef/panRef`, drag
  math tracks the live viewport even mid-fit-animation.
- **Click minimap**: main graph pans so the clicked graph-space point is
  centered in the canvas. Reasoning: `eventToGraph` does the inverse
  projection through `getBoundingClientRect()` (correct under arbitrary
  CSS scaling); `onPan` solves `pan = size/2 - graph*zoom`; `setPan`
  triggers re-render → main canvas draw reflects new pan.
- **Drag minimap** (mouse button held, move pointer): main canvas
  continuously scrubs in real time. Reasoning: `onMouseMove` checks
  `e.buttons === 0` — if button is held, it calls `onPan` for every move.
- **Re-render with new data** (filter change, search, local-graph toggle):
  graph re-centers. Reasoning: the build effect has `filteredNodes`,
  `displayEdges`, `size.w/h` as deps; rebuilding recreates the simulation,
  runs warmup, sets `needsFit = true` → next rAF fires `fit()` again.
- **Window resize**: simulation rebuilds (size deps change) → warmup
  re-runs → fit re-fires. The user's pan/zoom is intentionally overwritten
  on resize (existing behavior — `userNavigated` is informational only).
- **prefers-reduced-motion**: `fit()` snaps instantly instead of
  animating (the `reducedMotion` guard short-circuits before scheduling
  the rAF chain). All other behavior is unchanged.
- **Empty graph** (filter returns zero nodes): `KnowledgeGraphCanvas`
  returns the loading/empty placeholder, `Minimap` returns `null`, no
  errors.

## Verification

- `pnpm typecheck` against `apps/forge` — zero errors in either modified
  file. (Other pre-existing errors in connector-center / ideation /
  forge-terminal / dashboard components are unrelated to step-51.)
- Manual review of the rAF loop, hit-test, drag handler, and `Minimap`
  to confirm every zoom/pan read goes through `zoomRef`/`panRef`, so
  the in-flight fit animation is correctly painted and hit-tested.
