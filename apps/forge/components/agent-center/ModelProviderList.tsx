'use client';

import * as React from 'react';

import { ModelProviderCard } from '@/components/agent-center/ModelProviderCard';
import type { ModelProvider } from '@/lib/agent-center/data';

export interface ModelProviderListProps {
  providers: ReadonlyArray<ModelProvider>;
}

export function ModelProviderList({ providers }: ModelProviderListProps) {
  return (
    <ul
      role="list"
      aria-label="Model providers"
      data-testid="provider-list"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {providers.map((p) => (
        <li key={p.id}>
          <ModelProviderCard provider={p} />
        </li>
      ))}
    </ul>
  );
}
