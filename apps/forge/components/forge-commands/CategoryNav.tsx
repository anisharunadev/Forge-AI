'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  FORGE_COMMAND_CATEGORIES,
  type ForgeCommandCategoryId,
} from '@/lib/forge-commands';

export interface CategoryNavProps {
  active: ForgeCommandCategoryId;
  onChange: (id: ForgeCommandCategoryId) => void;
}

export function CategoryNav({ active, onChange }: CategoryNavProps) {
  return (
    <nav
      aria-label="Command categories"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3"
    >
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Categories
      </p>
      {FORGE_COMMAND_CATEGORIES.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onChange(cat.id)}
          className={cn(
            'rounded-md px-3 py-2 text-left text-sm transition-colors',
            active === cat.id
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/60',
          )}
          data-category={cat.id}
        >
          <div className="font-medium">{cat.label}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">
            {cat.description}
          </div>
        </button>
      ))}
    </nav>
  );
}
