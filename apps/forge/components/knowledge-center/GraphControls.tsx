'use client';

import * as React from 'react';
import { useReactFlow } from 'reactflow';

import { Button } from '@/components/ui/button';

export interface GraphControlsProps {
  onLayoutChange?: (layout: 'LR' | 'TB') => void;
  layout: 'LR' | 'TB';
}

export function GraphControls({ onLayoutChange, layout }: GraphControlsProps) {
  const rf = useReactFlow();

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="graph-controls">
      <Button size="sm" variant="outline" onClick={() => rf.zoomIn({ duration: 150 })} data-testid="graph-zoom-in">
        Zoom in
      </Button>
      <Button size="sm" variant="outline" onClick={() => rf.zoomOut({ duration: 150 })} data-testid="graph-zoom-out">
        Zoom out
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => rf.fitView({ padding: 0.2, duration: 200 })}
        data-testid="graph-fit"
      >
        Fit
      </Button>
      <div className="ml-2 inline-flex items-center gap-1 text-xs">
        <span className="text-forge-300">Layout</span>
        <Button
          size="sm"
          variant={layout === 'LR' ? 'default' : 'outline'}
          onClick={() => onLayoutChange?.('LR')}
          data-testid="graph-layout-lr"
        >
          L→R
        </Button>
        <Button
          size="sm"
          variant={layout === 'TB' ? 'default' : 'outline'}
          onClick={() => onLayoutChange?.('TB')}
          data-testid="graph-layout-tb"
        >
          T→B
        </Button>
      </div>
    </div>
  );
}
