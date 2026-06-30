'use client';

/**
 * Model Provider list (step-54 — Phase 2).
 *
 * Renders the list of providers using the live `useProviders` data.
 * Each card now has a "Test connection" button (see ModelProviderCard).
 * The empty state links to the wizard / Add Provider flow.
 *
 * Skill rules adopted:
 *   - **Empty state with value (Rule 15)** — never bare "No data";
 *     always a clear title + description + primary action.
 */

import * as React from 'react';
import { PlugZap, Plus } from 'lucide-react';

import { ModelProviderCard } from '@/components/agent-center/ModelProviderCard';
import { AddProviderDialog } from '@/components/agent-center/AddProviderDialog';
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
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <AddProviderDialog />
        </div>
        <EmptyState
          illustration={<PlugZap size={40} strokeWidth={1.5} />}
          title="Connect a model provider"
          description="Plug in OpenAI, Anthropic, or any OpenAI-compatible endpoint."
          primaryAction={{ label: 'Add Provider', onClick: () => undefined }}
          secondaryAction={onReadDocs ? { label: 'Read docs', onClick: onReadDocs } : undefined}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <AddProviderDialog />
      </div>
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
    </div>
  );
}