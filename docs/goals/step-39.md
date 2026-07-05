> **Status:** completed
/goal

Polish the Knowledge Graph in Forge AI Agent OS — currently shows 48 nodes and 72 edges but the initial layout is a clumsy cluster, labels overlap, and most of the canvas is empty. The right panel works great when you click a node, but the initial visual is broken. Goal: make the graph look like an Obsidian-style galaxy — nodes spread beautifully across the canvas, subtle glow effects, readable labels, community clustering. Read .claude/design-system/ first.

USER INTENT (clear): the graph is functional but the initial visual is unappealing. They want it to look like a galaxy of interconnected ideas — beautiful, spread out, with proper visual hierarchy. The right panel (info on click) is good; the canvas (initial view) is the problem.

INVOKE THE SKILL BEFORE CODING:
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "force directed graph layout community clustering spread visualization" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "Obsidian graph view galaxy network aesthetic dark mode" --domain style -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "node label anti-overlap sizing degree connections glow effect" --domain ux-guideline -f markdown
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "canvas zoom fit initial layout force simulation parameters" --domain ux-guideline -f markdown

Adopt every rule. Then implement:

==========================================================
FIX 1 — FORCE SIMULATION PARAMETERS (the main fix)
==========================================================

Current layout is too clustered because force simulation parameters are wrong. Tune them for a galaxy-like spread:

```js
const forceConfig = {
  // Charge force (repulsion) — MUCH stronger to spread nodes
  chargeForce: {
    strength: -800,        // was probably -100 to -300
    distanceMin: 50,
    distanceMax: 2000,
  },
  
  // Link force — keep connections but not too tight
  linkForce: {
    distance: 120,        // was probably 30-50
    strength: 0.3,         // weaker so it doesn't pull tight
  },
  
  // Center force — gentle pull to keep graph centered
  centerForce: {
    strength: 0.05,        // very gentle
  },
  
  // Collision force — prevent overlap
  collisionForce: {
    strength: 0.9,
    radius: node => node.size + 10,  // dynamic based on node size
  },
  
  // X/Y positioning forces — gentle positioning
  positionForce: {
    strength: 0.1,
  },
}

ADDITIONAL SETTINGS:

Initial node positions: spread randomly across a 2000×2000 area (not clustered at center)
Simulation alpha decay: 0.02 (slower decay = more time to settle nicely)
Simulation velocity decay: 0.4 (smoother settling)
Reheat on click (when clicking a node, re-run simulation briefly for that node's neighborhood)
Pin selected node to center of canvas
========================================================== FIX 2 — COMMUNITY DETECTION + CLUSTER COLORING
Run community detection (Louvain algorithm) on the graph. Each community gets:

Distinct color palette (use your semantic tokens: indigo, cyan, emerald, amber, rose, violet, etc.)
A subtle background "halo" — large translucent circle behind the cluster (radius = cluster size, opacity 0.05, color = cluster color)
Cluster label (faded, only visible when zoomed in)
All nodes in the cluster get that color
IMPLEMENTATION:

Use graphology-communities-louvain or run Louvain client-side
Compute on graph load + on graph change
Apply colors via a colorScale function
VISUAL EFFECT:

When viewing the whole graph, you see distinct "galaxies" of related nodes
Each galaxy has its own color
Subtle halos behind clusters create depth
Labels appear when zoomed in enough
========================================================== FIX 3 — NODE SIZING + VISUAL HIERARCHY
Not all nodes are equal. Visual hierarchy:

SIZE BY DEGREE (number of connections):

Hub nodes (>10 connections): 18-24px — these are the "important" nodes
Medium nodes (3-10 connections): 12-16px — normal
Leaf nodes (<3 connections): 8-10px — minor
SIZE BY IMPORTANCE (additional boost for):

Recently active (last 7 days): +20% size
Has unviewed items: +10% size
User's own nodes: +15% size
GLOW EFFECTS (using SVG filters):

Hub nodes: subtle outer glow (rgba(color, 0.3), 4px blur, 6px spread)
Selected node: bright glow (rgba(99,102,241, 0.6), 6px blur, 8px spread)
Hovered node: medium glow (rgba(255,255,255, 0.4), 3px blur, 4px spread)
On-click: pulse animation (glow expands + contracts, 1s)
========================================================== FIX 4 — LABEL ANTI-OVERLAP
Current: all labels show always → unreadable mess when many nodes.

REPLACE with smart label rendering:

Labels ONLY show when:
Node is hovered
Node is selected
Node is in selected node's local neighborhood (within 2 hops)
Zoom level is high enough to fit labels (zoom > 1.5x)
User explicitly toggles "show all labels"
Default: NO labels visible (clean canvas)
Toggle: "Show all labels" button in toolbar — forces all labels visible
Hover any node: label fades in (200ms), nearby nodes' labels also appear
Unhover: label fades out (200ms)
LABEL STYLE:

Background: --bg-elevated, --radius-sm, padding 4px 8px
Text: --text-xs, --fg-primary
Position: below the node (centered)
Max width: 200px, truncate with ellipsis
Font: Inter, NOT monospace
========================================================== FIX 5 — GALAXY BACKGROUND
Add subtle depth to the canvas:

Background: --bg-base (already dark)
Add: subtle radial gradient mesh (very faint) — 3 colored radial gradients positioned off-screen
Cyan radial top-left, opacity 0.04
Violet radial bottom-right, opacity 0.04
Indigo radial center, opacity 0.02
Add: tiny "star field" — 100 random 1px dots scattered across the canvas, low opacity (0.1-0.3)
Some larger "stars" (2px) at lower density
Subtle parallax: stars move slightly slower than nodes on pan
Add: subtle grid lines (already have dots) — keep but make them more subtle
EFFECT: the graph feels like floating in a cosmic space, not on a flat dark plane.

========================================================== FIX 6 — INITIAL VIEW (auto-fit + zoom level)
On graph load, don't start at default zoom. Compute optimal initial view:

Calculate bounding box of all nodes (with some padding)
Zoom to fit all nodes in the viewport (with 20% margin)
Center the graph in the canvas
Set initial zoom level to show ~30-50 nodes visible (not all 48, not just 10)
ADD a "Reset view" button to the zoom controls (bottom-right):

Click → smoothly animate to the optimal initial view
Useful when user gets lost in the graph
========================================================== FIX 7 — EDGE VISUAL IMPROVEMENT
Currently edges are likely all the same. Make them visually meaningful:

EDGE THICKNESS:

Thin (1px): default relationships
Medium (2px): strong relationships (multiple references)
Thick (3px): direct dependencies (blocker/implements)
EDGE STYLE:

Solid: structural relationship (implements, blocks)
Dashed: contextual relationship (mentioned, related)
Dotted: weak relationship (similar to)
EDGE COLOR (instead of one color):

Cyan: references
Emerald: implements
Amber: blocks
Rose: depends on
Violet: supersedes
Default: subtle gray
EDGE LABELS:

Show on hover only
Position: midpoint of edge
Style: small pill --bg-elevated --text-xs
"References" / "Implements" / "Blocks" / etc.
EDGE ANIMATION (when node selected):

Connected edges: full color + slightly thicker
Unconnected edges: fade to 10% opacity
========================================================== FIX 8 — INTERACTION POLISH
HOVER:

Node scales 1.2x
Glow appears
Label shows
Connected nodes: full color
Unconnected nodes: 30% opacity
Connected edges: full color
Unconnected edges: 10% opacity
Cursor: pointer
CLICK (select):

Node scales 1.3x + bright glow
Label shows permanently
Connected neighborhood: highlighted
Smooth pan/zoom to center the node in viewport
Right panel slides in (already works)
DOUBLE-CLICK:

Navigate to entity (already works)
Smooth zoom into the node
DRAG:

Drag to reposition (temporarily pin)
Release: physics re-engages
Shift+drag: permanent pin
Right-click: context menu (Open / Pin / Hide / Copy link)
SCROLL:

Zoom in/out (smooth, with momentum)
Min zoom: 0.2x (see entire graph)
Max zoom: 4x (see single node detail)
PAN:

Click + drag empty space
Touch: pinch to zoom, two-finger pan
========================================================== FIX 9 — PERFORMANCE
With 48 nodes and 72 edges, performance should be fine. But for 500+ nodes:

Disable physics simulation when zoomed out (only animate when zoomed in)
Use canvas rendering (not SVG) for >100 nodes
Throttle hover effects to 60fps
Lazy-render labels (only when needed)
Pre-compute community detection (don't run on every frame)
========================================================== FIX 10 — MINIMAP (the small overview)
Add a small minimap in the bottom-left corner:

200×150px, --bg-elevated, --radius-md, --shadow-md
Shows: full graph miniature + current viewport rectangle
Click minimap → pan main view to that location
Drag viewport rectangle → pan
Toggle: "Show minimap" (default on)
Respects dark theme
========================================================== FIX 11 — POLISHED HOVER PREVIEW (already good — enhance)
When hovering a node (right panel not open), show a SMALL floating preview card near the cursor:

280px wide, --bg-elevated, --radius-lg, --shadow-lg
HEADER: icon + name + kind badge
BODY: 1-paragraph description (truncated) + 2-3 connected entities (chips)
FOOTER: "Click to open full details →"
Auto-position to avoid edge clipping
Animation: fade in 150ms
========================================================== CONSTRAINTS
Keep all Step 27 functionality (backlinks, local graph, layouts, etc.)
Don't break the right panel detail view
Don't break the node kinds filter
Keep the search functionality
Use react-force-graph-2d (already installed) or migrate to sigma.js / cytoscape if needed
Add graphology + graphology-communities-louvain for community detection
All animations respect prefers-reduced-motion
Dark mode only
Maintain 60fps with current 48 nodes (no degradation)
========================================================== DELIVERABLE
files modified
Before/after sketch showing the new galaxy layout
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep right panel detail, keep filter bar, keep search, keep local graph toggle, keep ingest source functionality
Performance benchmark: 48 nodes, 72 edges should maintain 60fps
