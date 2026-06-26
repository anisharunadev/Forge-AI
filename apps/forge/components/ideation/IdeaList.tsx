'use client';

import * as React from 'react';
import { Lightbulb, Plus } from 'lucide-react';

import { IdeaCard } from './IdeaCard';
import type { Idea } from '@/lib/ideation/data';
import { EmptyState } from '@/src/components/empty-state';

export interface IdeaListProps {
  ideas: ReadonlyArray<Idea>;
  onSelect?: (idea: Idea) => void;
  emptyMessage?: string;
  onNewIdea?: () => void;
  onSeeExample?: () => void;
}

export function IdeaList({ ideas, onSelect, emptyMessage, onNewIdea, onSeeExample }: IdeaListProps) {
  if (ideas.length === 0) {
    return (
      <EmptyState
        illustration={<Lightbulb size={40} strokeWidth={1.5} />}
        title={emptyMessage ? 'No ideas match the current filters' : 'Capture your first idea'}
        description={
          emptyMessage
            ? 'Try clearing your filters to see every idea.'
            : 'Drop in a rough thought — AI will score it and draft a PRD.'
        }
        primaryAction={
          onNewIdea
            ? { label: 'New Idea', onClick: onNewIdea, icon: <Plus size={14} /> }
            : undefined
        }
        secondaryAction={onSeeExample ? { label: 'See example', onClick: onSeeExample } : undefined}
        suggestions={
          emptyMessage ? undefined : ['AI code reviewer', 'Slack summarizer', 'Invoice parser']
        }
      />
    );
  }

  return (
    <ul
      role="list"
      aria-label="Ideas"
      data-testid="idea-list"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {ideas.map((idea) => (
        <li key={idea.id}>
          <IdeaCard idea={idea} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}