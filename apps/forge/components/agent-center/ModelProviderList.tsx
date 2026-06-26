'use client';

import * as React from 'react';
import { PlugZap, Plus } from 'lucide-react';

import { ModelProviderCard } from '@/components/agent-center/ModelProviderCard';
import type { ModelProvider } from '@/lib/agent-center/data';
import { EmptyState } from '@/src/components/empty-state';

export interface ModelProviderListProps {
  providers: ReadonlyArray<ModelProvider>;
  onConnect?: () => void;
  onReadDocs?: () => void;
}

export function ModelProviderList({ providers, onConnect, onReadDocs }: ModelProviderListProps) {
  if (providers.length === 0) {
    return (
      <EmptyState
        illustration={<PlugZap size={40} strokeWidth={1.5} />}
        title="Connect a model provider"
        description="Plug in OpenAI, Anthropic, or any OpenAI-compatible endpoint."
        primaryAction={onConnect ? { label: 'Connect Provider', onClick: onConnect, icon: <Plus size={14} /> } : undefined}
        secondaryAction={onReadDocs ? { label: 'Read docs', onClick: onReadDocs } : undefined}
      />
    );
  }
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