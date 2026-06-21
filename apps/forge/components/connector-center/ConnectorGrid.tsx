'use client';

import * as React from 'react';

import { ConnectorCard } from '@/components/connector-center/ConnectorCard';
import type { Connector } from '@/lib/connector-center/data';

export interface ConnectorGridProps {
  connectors: ReadonlyArray<Connector>;
  onSelect?: (connector: Connector) => void;
}

export function ConnectorGrid({ connectors, onSelect }: ConnectorGridProps) {
  if (connectors.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="connector-grid-empty">
        No connectors match the current filters.
      </div>
    );
  }
  return (
    <ul
      role="list"
      aria-label="Connected connectors"
      data-testid="connector-grid"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {connectors.map((c) => (
        <li key={c.id}>
          <ConnectorCard connector={c} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
