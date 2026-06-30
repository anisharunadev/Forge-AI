'use client';

/**
 * `<IdeationArchPreviewPanel>` — Step-57 Zone 6.
 *
 * Wrapper that wires the `ArchPreviewGrid` component to the canonical
 * TanStack Query hook (`useArchPreview` per-idea + fan-out via the
 * adapter) with loading / error / retry affordances.
 *
 * The wire backend currently exposes per-idea previews only
 * (`GET /ideation/ideas/{id}/arch-preview`); the `useArchPreviews`
 * roll-up endpoint is marked `enabled: false` until it lands. The
 * adapter synthesises a placeholder preview per idea so the grid is
 * never blank for an empty backend.
 */

import * as React from 'react';

import { ArchPreviewGrid } from '@/components/ideation/ArchPreviewGrid';
import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';

import { useArchPreviewsAdapter } from '@/lib/hooks/useIdeationAdapters';

import type { ArchPreview } from '@/lib/ideation/data';

export interface IdeationArchPreviewPanelProps {
  readonly onOpen?: (preview: ArchPreview) => void;
  readonly onGenerate?: () => void;
}

export function IdeationArchPreviewPanel({
  onOpen,
  onGenerate,
}: IdeationArchPreviewPanelProps) {
  const adapter = useArchPreviewsAdapter();

  return (
    <IdeationQueryState
      isLoading={adapter.isLoading}
      isError={adapter.isError}
      error={adapter.error}
      onRetry={adapter.refetch}
      loadingRows={3}
      errorTitle="Couldn't load architecture previews"
    >
      <ArchPreviewGrid
        previews={adapter.data}
        onOpen={onOpen}
        onGenerate={onGenerate}
      />
    </IdeationQueryState>
  );
}