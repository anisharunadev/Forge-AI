'use client';

/**
 * `<IdeationRoadmapPanel>` — Step-57 Zone 6.
 *
 * Wrapper that wires the `RoadmapTimeline` component to the canonical
 * TanStack Query hook (`useRoadmaps`) via the legacy-shape adapter,
 * with loading / error / retry affordances per Rule 15.
 */

import * as React from 'react';

import { RoadmapTimeline } from '@/components/ideation/RoadmapTimeline';
import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';

import { useRoadmapAdapter, toastAdapterError } from '@/lib/hooks/useIdeationAdapters';

import type { RoadmapItem } from '@/lib/ideation/data';

export interface IdeationRoadmapPanelProps {
  readonly onSelect?: (item: RoadmapItem) => void;
  readonly onMoveQuarter?: (itemId: string, toQuarter: string) => void;
}

export function IdeationRoadmapPanel({
  onSelect,
  onMoveQuarter,
}: IdeationRoadmapPanelProps) {
  const adapter = useRoadmapAdapter();

  // The wire roadmap endpoint doesn't (yet) persist per-item moves
  // — surface the move as a toast and keep the legacy console.info
  // trail for observability until the backend lands `PATCH
  // /ideation/roadmaps/{id}/items/{idea_id}`.
  const handleMove = React.useCallback(
    (itemId: string, toQuarter: string) => {
      // eslint-disable-next-line no-console
      console.info('[ideation:roadmap] move-quarter (adapters)', { itemId, toQuarter });
      onMoveQuarter?.(itemId, toQuarter);
    },
    [onMoveQuarter],
  );

  return (
    <IdeationQueryState
      isLoading={adapter.isLoading}
      isError={adapter.isError}
      error={adapter.error}
      onRetry={adapter.refetch}
      loadingRows={4}
      errorTitle="Couldn't load roadmap"
    >
      <RoadmapTimeline
        items={adapter.data}
        onSelect={onSelect}
        onMoveQuarter={handleMove}
      />
    </IdeationQueryState>
  );
}

// Re-export so the page (or tests) can wire a future mutation.
export { useRoadmapAdapter, toastAdapterError };