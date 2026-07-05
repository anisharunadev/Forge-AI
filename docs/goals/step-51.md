> **Status:** completed
/goal


Fix two persistent bugs in the Knowledge Center in Forge AI Agent OS:

1. Nodes render in the top-left area on initial load instead of being centered

2. Minimap is not functional (viewport indicator broken, panning doesn't work)


Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "force graph center on load fit viewport simulation settle" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "minimap viewport indicator tracking pan zoom graph" --domain ux-guideline -f markdown


Adopt every rule. Then fix both bugs:


==========================================================

FIX 1 — CENTER ON LOAD (the persistent bug)

==========================================================


ROOT CAUSE: centering is happening BEFORE the force simulation settles, when nodes are still at (0,0) or random positions. The centering is then "baked in" even after nodes move.


PROPER FIX (using react-force-graph-2d API):


```typescript

import { useEffect, useRef } from 'react';

import ForceGraph2D from 'react-force-graph-2d';


function KnowledgeGraph() {

  const fgRef = useRef<any>();

  const containerRef = useRef<HTMLDivElement>(null);


  useEffect(() => {

    // Wait for the graph to be ready AND the simulation to settle

    if (!fgRef.current) return;


    const handleEngineStop = () => {

      // The simulation has finished settling — NOW center and fit

      const padding = 80;

      

      // Method 1: Use built-in zoomToFit (handles centering + zoom together)

      fgRef.current.zoomToFit(padding, 500);  // 500ms animation

      

      // OR Method 2: Manual centering (more control)

      // const nodes = fgRef.current.d3Nodes();

      // if (nodes.length === 0) return;

      // const xs = nodes.map(n => n.x);

      // const ys = nodes.map(n => n.y);

      // const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

      // const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;

      // fgRef.current.centerAt(centerX, centerY, 500);

      

      console.log('Graph centered after simulation settled');

    };


    // Listen for simulation end event

    fgRef.current.d3Force('simulation').on('end', handleEngineStop);


    // Also try after a timeout (fallback if 'end' doesn't fire)

    const timeoutId = setTimeout(handleEngineStop, 3000);


    return () => {

      clearTimeout(timeoutId);

      if (fgRef.current) {

        fgRef.current.d3Force('simulation').on('end', null);

      }

    };

  }, [data]);  // re-run when data changes


  return (

    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>

      <ForceGraph2D

        ref={fgRef}

        graphData={data}

        // ... other props

      />

    </div>

  );

}
KEY POINTS:

1.
Listen for 'end' event on the simulation, NOT just a setTimeout
2.
Call zoomToFit with padding (80px) so nodes don't touch edges
3.
Use duration (500ms) for smooth animation
4.
Cleanup the event listener on unmount
5.
Re-run when data changes (filters, search, etc.)
========================================================== FIX 2 — FIX MINIMAP
ROOT CAUSE: the minimap is rendering but not connected to the main graph's viewport state.

CHECKLIST:

A. Is the minimap component IMPORTED and WIRED?

If using a custom minimap: make sure it shares state with main graph
If using a library minimap (like react-force-graph's built-in): check props
B. For react-force-graph-2d, there's NO built-in minimap

Need to implement custom minimap OR use a third-party one
C. CUSTOM MINIMAP IMPLEMENTATION:

typescript

Copy
function MiniMap({ graphRef, data, width = 200, height = 150 }) {

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [viewportRect, setViewportRect] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const [graphBounds, setGraphBounds] = useState({ minX: 0, maxX: 0, minY: 0, maxY: 0 });


  // Update bounds and viewport when graph changes

  useEffect(() => {

    if (!graphRef.current) return;

    

    const updateMinimap = () => {

      const nodes = graphRef.current.d3Nodes();

      if (nodes.length === 0) return;

      

      // Calculate graph bounds

      const xs = nodes.map(n => n.x);

      const ys = nodes.map(n => n.y);

      const bounds = {

        minX: Math.min(...xs),

        maxX: Math.max(...xs),

        minY: Math.min(...ys),

        maxY: Math.max(...ys),

      };

      setGraphBounds(bounds);

      

      // Get current viewport

      const center = graphRef.current.centerAt();

      const zoom = graphRef.current.zoom();

      // ... calculate viewport rect based on center + zoom + canvas size

      

      renderMinimap();

    };

    

    // Listen to graph events

    graphRef.current.d3ReheatSimulation();

    const intervalId = setInterval(updateMinimap, 500);  // Update every 500ms

    

    return () => clearInterval(intervalId);

  }, [data, graphRef]);


  // Render minimap (nodes as dots, viewport as rectangle)

  const renderMinimap = () => {

    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    

    // Clear

    ctx.clearRect(0, 0, width, height);

    

    // Calculate scale to fit graph bounds in minimap

    const graphWidth = graphBounds.maxX - graphBounds.minX;

    const graphHeight = graphBounds.maxY - graphBounds.minY;

    const scale = Math.min(width / graphWidth, height / graphHeight) * 0.8;

    

    // Draw nodes

    data.nodes.forEach(node => {

      const x = (node.x - graphBounds.minX) * scale + (width - graphWidth * scale) / 2;

      const y = (node.y - graphBounds.minY) * scale + (height - graphHeight * scale) / 2;

      

      ctx.beginPath();

      ctx.arc(x, y, 2, 0, Math.PI * 2);

      ctx.fillStyle = getNodeColor(node.kind);

      ctx.fill();

    });

    

    // Draw viewport rectangle

    ctx.strokeStyle = '#6366F1';

    ctx.lineWidth = 1;

    ctx.strokeRect(

      viewportRect.x * scale,

      viewportRect.y * scale,

      viewportRect.w * scale,

      viewportRect.h * scale

    );

  };


  // Click handler to pan main graph

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {

    if (!graphRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();

    const x = e.clientX - rect.left;

    const y = e.clientY - rect.top;

    

    // Convert minimap coordinates to graph coordinates

    const graphX = (x / width) * (graphBounds.maxX - graphBounds.minX) + graphBounds.minX;

    const graphY = (y / height) * (graphBounds.maxY - graphBounds.minY) + graphBounds.minY;

    

    // Center main graph on this point

    graphRef.current.centerAt(graphX, graphY, 500);

  };


  return (

    <canvas

      ref={canvasRef}

      width={width}

      height={height}

      onClick={handleClick}

      style={{

        position: 'absolute',

        bottom: 16,

        right: 16,

        background: 'rgba(20, 20, 22, 0.9)',

        borderRadius: 8,

        border: '1px solid rgba(255,255,255,0.1)',

        cursor: 'pointer',

        zIndex: 10,

      }}

    />

  );

}
KEY POINTS:

1.
Update minimap every 500ms (or on graph events)
2.
Click minimap to pan main graph
3.
Viewport indicator shows current visible area
4.
Node colors match the main graph (use the same getNodeColor function)
D. ALTERNATIVE: USE A LIBRARY

Install react-force-graph-2d already has no minimap, but...
Consider: reactflow (which has built-in minimap) — if willing to migrate
Or: use a community minimap component for react-force-graph
========================================================== FIX 3 — COMBINED FIX (use this exact pattern)
typescript

Copy
import { useEffect, useRef, useState, useCallback } from 'react';

import ForceGraph2D from 'react-force-graph-2d';


export default function KnowledgeGraph({ data }: { data: GraphData }) {

  const fgRef = useRef<any>();

  const [isReady, setIsReady] = useState(false);


  // Wait for graph to be ready, then center when simulation settles

  useEffect(() => {

    if (!fgRef.current || !isReady) return;

    

    let cancelled = false;

    

    const centerGraph = () => {

      if (cancelled || !fgRef.current) return;

      

      const nodes = fgRef.current.d3Nodes();

      if (nodes.length === 0) return;

      

      // Wait one frame to ensure nodes have positions

      requestAnimationFrame(() => {

        if (cancelled || !fgRef.current) return;

        

        // zoomToFit handles both centering and zoom

        fgRef.current.zoomToFit(400, 500);  // 400ms duration

      });

    };

    

    // Listen for simulation end

    const simulation = fgRef.current.d3Force('simulation');

    simulation.on('end', centerGraph);

    

    // Fallback: try after 2s

    const fallbackTimeout = setTimeout(centerGraph, 2000);

    

    return () => {

      cancelled = true;

      clearTimeout(fallbackTimeout);

      if (simulation) simulation.on('end', null);

    };

  }, [data, isReady]);


  return (

    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      <ForceGraph2D

        ref={fgRef}

        graphData={data}

        onEngineTick={() => {/* tick callback */}}

        // ... other props

        cooldownTicks={100}  // Stop simulation after 100 ticks of stillness

        onRenderFramePost={(ctx, globalScale) => {

          // Optional: custom rendering here

        }}

      />

      <MiniMap graphRef={fgRef} data={data} />

    </div>

  );

}
========================================================== FIX 4 — COMMON MISTAKES TO AVOID
1.
Don't use setTimeout alone — simulation might not be done yet
2.
Don't call centerAt(0, 0) — that's the origin, not the graph center
3.
Don't forget to wait for isReady — calling centerAt before graph is mounted will fail
4.
Don't use cooldownTicks={0} — simulation will run forever
5.
Don't re-center on every render — only on data change
6.
Don't use a non-zero zoom in zoomToFit without padding — nodes will be cut off
========================================================== FIX 5 — DEBUGGING
If centering STILL doesn't work, add console.logs:

typescript

Copy
const centerGraph = () => {

  console.log('Centering graph...');

  console.log('Nodes count:', fgRef.current.d3Nodes().length);

  console.log('Canvas size:', {

    width: containerRef.current?.offsetWidth,

    height: containerRef.current?.offsetHeight,

  });

  console.log('First 3 node positions:', 

    fgRef.current.d3Nodes().slice(0, 3).map(n => ({ x: n.x, y: n.y }))

  );

  

  fgRef.current.zoomToFit(400, 500);

};
This will show you:

If the simulation finished (nodes have real positions, not 0,0)
The actual canvas size being used
What zoomToFit is calculating
========================================================== CONSTRAINTS
Don't change the data structure
Don't break the existing filters/search
Don't break the right panel detail view
Keep the existing zoom controls
Re-centering should be smooth (animation), not jarring
Minimap should update in real-time as user pans/zooms
========================================================== DELIVERABLE
files modified
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the right panel, keep the filters, keep the search, keep the existing zoom controls
Test: load the page → graph centers on load (not top-left)
Test: pan the graph → minimap viewport indicator follows
Test: click minimap → main graph pans to that location
Test: re-render with new data → graph re-centers
