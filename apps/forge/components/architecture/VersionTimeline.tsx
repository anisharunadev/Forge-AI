'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { ArchitectureVersion } from '@/lib/architecture/data';

export interface VersionTimelineProps {
  versions: ReadonlyArray<ArchitectureVersion>;
}

export function VersionTimeline({ versions }: VersionTimelineProps) {
  return (
    <ol
      aria-label="Architecture versions"
      className="relative ml-3 border-l border-forge-700/40"
      data-testid="version-timeline"
    >
      {versions.map((v) => (
        <li
          key={v.version}
          data-testid="version-timeline-item"
          data-version={v.version}
          className="mb-6 ml-6"
        >
          <span
            className={cn(
              'absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full border border-forge-700 bg-forge-800 text-[10px] font-bold text-forge-200',
            )}
            aria-hidden="true"
          >
            •
          </span>
          <h3 className="text-base font-semibold text-forge-50">{v.version}</h3>
          <time className="block font-mono text-xs text-forge-300">
            {new Date(v.releasedAt).toLocaleDateString()}
          </time>
          <ul className="mt-2 list-inside list-disc text-sm text-forge-100">
            {v.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
