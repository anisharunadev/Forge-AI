'use client';

import * as React from 'react';
import { Plus, Star, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CATEGORY_LABEL, type MarketplaceConnector } from '@/lib/connector-center/data';
import { MCPIcon } from '@/lib/connector-center/mcp-icon';

export interface MarketplaceCardProps {
  connector: MarketplaceConnector;
  onInstall?: (connector: MarketplaceConnector) => void;
}

export function MarketplaceCard({ connector, onInstall }: MarketplaceCardProps) {
  return (
    <article
      className="card flex flex-col gap-3"
      data-testid="marketplace-card"
      data-connector-id={connector.id}
      data-connector-icon={connector.id}
    >
      <header className="flex items-start gap-3">
        <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
          <MCPIcon connectorId={connector.id} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-forge-300">
            {CATEGORY_LABEL[connector.category]}
          </p>
          <h3 className="text-base font-semibold leading-tight">
            {connector.displayName}
          </h3>
          <p className="text-[10px] text-forge-300">by {connector.publisher}</p>
        </div>
      </header>

      <p className="text-xs text-forge-200">{connector.shortDescription}</p>

      <footer className="mt-auto flex items-center justify-between border-t border-forge-800 pt-2 text-[10px]">
        <div className="flex items-center gap-3 text-forge-300">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-300" aria-hidden="true" />
            {connector.rating.toFixed(1)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {connector.installs.toLocaleString()}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onInstall?.(connector)}
          data-testid="marketplace-install"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Install
        </Button>
      </footer>
    </article>
  );
}
