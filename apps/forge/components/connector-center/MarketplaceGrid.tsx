'use client';

import * as React from 'react';

import { MarketplaceCard } from '@/components/connector-center/MarketplaceCard';
import type { MarketplaceConnector } from '@/lib/connector-center/data';

export interface MarketplaceGridProps {
  connectors: ReadonlyArray<MarketplaceConnector>;
  onInstall?: (connector: MarketplaceConnector) => void;
}

export function MarketplaceGrid({ connectors, onInstall }: MarketplaceGridProps) {
  return (
    <ul
      role="list"
      aria-label="Marketplace connectors"
      data-testid="marketplace-grid"
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {connectors.map((c) => (
        <li key={c.id}>
          <MarketplaceCard connector={c} onInstall={onInstall} />
        </li>
      ))}
    </ul>
  );
}
