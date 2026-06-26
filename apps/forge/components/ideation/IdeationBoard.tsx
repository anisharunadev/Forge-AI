'use client';

/**
 * Ideation Center — Board view router (Step 5).
 *
 * Composes Kanban (default) / List / Timeline behind a
 * `SegmentedControl` toggle. Shares the same `Idea[]` data shape
 * across all three views and routes selection to the parent.
 */

import * as React from 'react';
import { SegmentedControl } from '@/components/agent-center/AgentCenterControls';
import { IdeaKanban, type KanbanColumnKey } from './IdeaKanban';
import { IdeaList } from './IdeaList';
import { IdeaTimeline } from './IdeaTimeline';
import type { Idea } from '@/lib/ideation/data';

export type IdeationView = 'kanban' | 'list' | 'timeline';

export interface IdeationBoardProps {
  ideas: ReadonlyArray<Idea>;
  view: IdeationView;
  onViewChange: (view: IdeationView) => void;
  onSelect?: (idea: Idea) => void;
  onAddNew?: (key: KanbanColumnKey) => void;
  onMenu?: (idea: Idea) => void;
  onMove?: (ideaId: string, toColumn: KanbanColumnKey) => void;
}

export function IdeationBoard({
  ideas,
  view,
  onViewChange,
  onSelect,
  onAddNew,
  onMenu,
  onMove,
}: IdeationBoardProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="ideation-board" data-view={view}>
      <div className="flex items-center justify-end">
        <SegmentedControl
          ariaLabel="Ideas view"
          value={view}
          onChange={(v) => onViewChange(v as IdeationView)}
          options={[
            { value: 'kanban', label: 'Kanban', testId: 'view-kanban' },
            { value: 'list', label: 'List', testId: 'view-list' },
            { value: 'timeline', label: 'Timeline', testId: 'view-timeline' },
          ]}
        />
      </div>

      {view === 'kanban' ? (
        <IdeaKanban
          ideas={ideas}
          onSelect={onSelect}
          onAddNew={onAddNew}
          onMenu={onMenu}
          onMove={onMove}
        />
      ) : null}

      {view === 'list' ? (
        <IdeaList ideas={ideas} onSelect={onSelect} emptyMessage="No ideas match the current filters" />
      ) : null}

      {view === 'timeline' ? <IdeaTimeline ideas={ideas} onSelect={onSelect} /> : null}
    </div>
  );
}
