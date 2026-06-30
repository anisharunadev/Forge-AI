'use client';

/**
 * `<IdeationApprovalsPanel>` — Step-57 Zone 6.
 *
 * Wrapper that wires the `ApprovalsInbox` component to the canonical
 * TanStack Query hooks (`useApprovals` + `useDecideApproval`) via the
 * legacy-shape adapter, with loading / error / retry affordances.
 *
 * The wire shape accepts `decision: 'approve' | 'deny' | 'request_changes'`;
 * the legacy component emits `'approve' | 'reject'`. We translate at
 * the boundary so the inbox UI keeps the simpler two-button model.
 */

import * as React from 'react';

import { ApprovalsInbox } from '@/components/ideation/ApprovalsInbox';
import { IdeationQueryState } from '@/components/ideation/IdeationQueryState';

import {
  useApprovalsAdapter,
} from '@/lib/hooks/useIdeationAdapters';

import type { Approval } from '@/lib/ideation/data';

export interface IdeationApprovalsPanelProps {
  readonly onOpen?: (approval: Approval) => void;
}

export function IdeationApprovalsPanel({ onOpen }: IdeationApprovalsPanelProps) {
  const adapter = useApprovalsAdapter();
  const { decide } = adapter;

  const handleDecide = React.useCallback(
    (a: Approval, decision: 'approve' | 'reject') => {
      decide.mutate({
        approvalId: a.id,
        decision: decision === 'reject' ? 'deny' : 'approve',
        reason: null,
      });
    },
    [decide],
  );

  return (
    <IdeationQueryState
      isLoading={adapter.isLoading}
      isError={adapter.isError}
      error={adapter.error}
      onRetry={adapter.refetch}
      loadingRows={4}
      errorTitle="Couldn't load approvals"
    >
      <ApprovalsInbox
        approvals={adapter.data}
        onDecide={handleDecide}
        onOpen={onOpen}
      />
    </IdeationQueryState>
  );
}