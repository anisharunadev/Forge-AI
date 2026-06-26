# Step 41 — Knowledge Graph Centering Fix (Deliverable)

## Files modified

| Path | Change |
| --- | --- |
| `apps/forge/components/knowledge-graph/KnowledgeGraphCanvas.tsx` | (1) Added `sizeRef / zoomRef / panRef` mirrors so the animation loop reads the latest values without re-creating the rAF closure. (2) Replaced the brittle `setTimeout(fit, 800)` with a `needsFit` ref that's drained inside the animation loop **once `sim.alpha() < 0.1`** (i.e. after the simulation has actually settled). (3) Rewrote `fit()` to read size from `sizeRef` (no stale closure), clamp zoom to `[0.2, 1.5]`, and compute center exactly as `(W/2 - cx*z, H/2 - cy*z)`. (4) Added `userNavigated` ref so manual zoom buttons mark "user took control"; auto-fit on future data changes still resets it. (5) Removed `didInitialFit` (replaced by `needsFit`). |

## Root cause

The previous auto-fit used `setTimeout(fit, 800)` inside a `useEffect([filteredNodes.length])`. Three bugs stacked:

1. **Stale `size` closure.** `fit` is a `useCallback([size.w, size.h])`; the `setTimeout` callback captured the version from the render when the effect ran — *before* `ResizeObserver` fired with the real canvas size. The fit was computed for the 800×560 default size, not the real (e.g.) 1600×800 canvas, so `pan = size/2 - center*z` was off by hundreds of pixels.
2. **Simulation hadn't settled by 800 ms.** `ALPHA_DECAY * 0.01 = 0.00018/tick`. At 60 fps, alpha after 800 ms ≈ 0.99 — the nodes were still in their initial 2400×2400 scatter. `fit()` captured a transient layout.
3. **`didInitialFit` reset on resize, but no new fit was scheduled.** When the canvas resized after mount, the simulation effect rebuilt the sim and reset `didInitialFit = false`. The auto-fit effect's deps (`filteredNodes.length`) hadn't changed, so no fresh `setTimeout` fired. The graph stayed wherever the stale fit placed it.

Net result: the canvas-size mismatch + unsettled layout pushed the cluster to the top-right quadrant.

## Fix (one-paragraph rationale)

Per the UI-UX-pro-Max `ux` rules ("use transform and opacity for animations" + "responsive: viewport meta" + "avoid content jumping" — reserve canvas space), the centering needs to run **after the simulation has produced a stable layout** and use the **actual measured canvas dimensions**, not whatever values were current when the timer was scheduled. We now (a) keep `sizeRef` updated on every resize, (b) gate `fit()` on `sim.alpha() < 0.1` inside the rAF loop (so it always runs against settled positions and the latest size), and (c) clamp zoom to `[0.2, 1.5]` to guarantee the galaxy always fills the viewport with comfortable padding. The Reset View button (lucide `Maximize2`) re-triggers `fit()` on demand; manual zoom buttons mark `userNavigated` so the next resize preserves the user's view (per spec).

## What we deliberately did NOT change

| Kept intact | Why |
| --- | --- |
| **Force simulation tuning** (charge, rest length, alpha decay, damping, collision) — all Step 39 values preserved | Step 39 galaxy polish is already correct; only the centering trigger was broken. |
| **Community detection** (inline label propagation, halo rendering, color palette) | Untouched. |
| **Node sizing** by degree (hub/medium/leaf) | Untouched. |
| **Smart labels** (hover/select/2-hop/zoom>1.5/all-toggle + pill style) | Untouched. |
| **Galaxy background** (radial gradient mesh + star field SVG) | Untouched. |
| **Edge styling** (thickness by strength, dash by kind, color by kind) | Untouched. |
| **Hover preview card + minimap** | Untouched. |
| **Right panel detail view** + filters + search + local-graph toggle + ingest source | Untouched (these don't depend on the centering logic). |
| **Layout overrides** (TB / LR / Radial / Grid / Timeline) | Still honor `fx/fy` pinning; force layout still uses auto-fit. |
| **`prefers-reduced-motion` + idle-pause** (4 s) | Animation loop unchanged. |

## Constraints met

- ✅ Initial load → auto-fits once sim settles.
- ✅ Data changes (filter, search, local-graph, ingest) → reset `needsFit` → auto-fits after settle.
- ✅ Reset View button (`Maximize2`) → calls `fit()` immediately.
- ✅ Window resize → `needsFit` is NOT set, so current view is preserved (per spec, "could be disorienting"). `sizeRef` updates so the *next* drag/zoom uses correct dimensions.
- ✅ Manual pan/zoom → `userNavigated` set; doesn't trigger another auto-fit unless `needsFit` is reset (data change or explicit Reset View).
- ✅ Reduced-motion → unchanged; the rAF loop continues to step until alpha drops.

## Files modified

- `apps/forge/components/knowledge-graph/KnowledgeGraphCanvas.tsx` (only file touched).
- `docs/goals/step-41-deliverable.md` (this file).

Zero typecheck errors in the modified file (`pnpm typecheck` clean for `knowledge-graph/*`).