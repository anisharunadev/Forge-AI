'use client';

/**
 * `<IdeationPRDPanel>` — Step-57 Zone 6.
 *
 * Wrapper that wires the `PRDList` + `PRDViewer` components to the
 * canonical TanStack Query hooks via the legacy-shape adapter.
 *
 * The wire shape exposes PRDs per-idea (`GET /ideation/ideas/{id}/prd`)
 * rather than as a flat list, so the adapter currently returns an
 * empty `PRD[]` — the PRDList's "No PRDs yet" empty state is the
 * canonical surface until the dedicated list endpoint ships. When
 * that lands, flip `usePRDsAdapter` to the new endpoint and the rest
 * of the panel is unchanged.
 */

import * as React from 'react';

import { PRDList } from '@/components/ideation/PRDList';
import { PRDViewer } from '@/components/ideation/PRDViewer';
import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';

import { usePRDsAdapter } from '@/lib/hooks/useIdeationAdapters';

import type { Idea, PRD } from '@/lib/ideation/data';

export interface IdeationPRDPanelProps {
  readonly ideas?: ReadonlyArray<Idea>;
  readonly onSelect?: (prd: PRD) => void;
  readonly onGenerate?: () => void;
}

export function IdeationPRDPanel({ ideas, onSelect, onGenerate }: IdeationPRDPanelProps) {
  const adapter = usePRDsAdapter();

  const activePRD = adapter.data[0] ?? null;

  return (
    <IdeationQueryState
      isLoading={adapter.isLoading}
      isError={adapter.isError}
      error={adapter.error}
      onRetry={adapter.refetch}
      loadingRows={3}
      errorTitle="Couldn't load PRDs"
    >
      <PRDList prds={adapter.data} ideas={ideas} onSelect={onSelect} onGenerate={onGenerate} />
      {activePRD ? <PRDViewer prd={activePRD} /> : null}
    </IdeationQueryState>
  );
}