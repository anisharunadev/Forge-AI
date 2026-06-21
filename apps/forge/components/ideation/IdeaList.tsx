'use client';

import * as React from 'react';

import { IdeaCard } from './IdeaCard';
import type { Idea } from '@/lib/ideation/data';

export interface IdeaListProps {
  ideas: ReadonlyArray<Idea>;
  onSelect?: (idea: Idea) => void;
  emptyMessage?: string;
}

export function IdeaList({ ideas, onSelect, emptyMessage }: IdeaListProps) {
  if (ideas.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="idea-list-empty">
        {emptyMessage ?? 'No ideas match the current filters.'}
      </div>
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
