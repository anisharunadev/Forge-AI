> **Status:** completed
/goal

Fix the Knowledge Graph in Forge AI Agent OS — the nodes are positioned in the top-right of the canvas by default, leaving most of the viewport empty. The graph should be CENTERED. Read .claude/design-system/ first.

USER ISSUE (from screenshot): 48 nodes are clustered in the top-right quadrant of the canvas. The bottom-left ~60% of the viewport is empty. The graph is supposed to auto-fit + center on initial load.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "graph auto-fit center bounding box viewport transform" --domain ux-guideline -f markdown

Then implement:

==========================================================
FIX 1 — DIAGNOSE THE CENTERING BUG
==========================================================

The issue is one (or a combination) of:
- The initial transform isn't being set to center the graph
- The auto-fit calculation is using wrong bounds
- The graph coordinates are being offset incorrectly
- The canvas size detection is off (e.g., reading width before mount)

Find the existing graph component (likely in src/components/knowledge-graph/ or src/app/(workspace)/knowledge-center/) and audit:
- How is the initial transform set?
- Is the canvas size read correctly (after mount, not before)?
- Is the bounding box calculation correct?
- Is the force simulation completing before centering is applied?
- Is there a padding/margin offset that's not being accounted for?

==========================================================
FIX 2 — PROPER CENTERING IMPLEMENTATION
==========================================================

Use this robust centering logic (works for both react-force-graph-2d and reactflow):

```js
function centerGraph(graphInstance, canvasWidth, canvasHeight, padding = 80) {
  // Wait for simulation to settle
  setTimeout(() => {
    // Get bounding box of all nodes
    const nodes = graphInstance.d3Nodes();
    if (!nodes || nodes.length === 0) return;
    
    // Calculate bounds
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    // Add padding
    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate zoom to fit
    const zoom = Math.min(
      (canvasWidth - padding * 2) / graphWidth,
      (canvasHeight - padding * 2) / graphHeight,
      1.5  // max zoom
    );
    
    // Apply transform
    graphInstance.zoomToFit(padding, 200);  // 200ms animation
    // OR for more control:
    graphInstance.zoom(zoom, 200);
    graphInstance.centerAt(centerX, centerY, 200);
  }, 500);  // wait for simulation to settle
}

KEY REQUIREMENTS:

Wait for force simulation to settle before centering (use setTimeout or simulation 'end' event)
Use the actual canvas dimensions (not the viewport)
Account for padding around the canvas (e.g., the canvas might be inside a container with margins)
Re-center when:
Initial load
Data changes
Window resizes
Filter changes
User clicks "Reset view" button
========================================================== FIX 3 — RESET VIEW BUTTON
The zoom controls in the bottom-right already exist. Make sure the "Reset view" / "Fit to screen" button (lucide Maximize2) properly centers the graph using the logic above.

========================================================== FIX 4 — WINDOW RESIZE HANDLER
Add a resize observer or window resize handler that:

Detects canvas size changes
Re-centers the graph (or just maintains current view, user preference)
Debounce the resize handler to avoid thrashing
========================================================== CONSTRAINTS
Don't break the existing graph functionality (force simulation, community detection, etc.)
Don't break the right panel detail view
Keep the existing toolbar + filters
Keep the local graph toggle working
The "auto-center" should happen on initial load and when the "Reset view" button is clicked
For window resize, keep current view (don't recenter) — could be disorienting
The graph should still maintain its current position when user pans/zooms — only reset on explicit action or initial load
========================================================== DELIVERABLE
files modified
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep force simulation, keep community detection, keep node sizing, keep all other graph features


