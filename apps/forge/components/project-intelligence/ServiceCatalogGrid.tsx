'use client';

import * as React from 'react';
import { Server } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export interface ServiceInfo {
  id: string;
  name: string;
  repo: string;
  language: string;
  loc: number;
}

export interface ServiceCatalogGridProps {
  services: ReadonlyArray<ServiceInfo>;
}

export function ServiceCatalogGrid({ services }: ServiceCatalogGridProps) {
  return (
    <ul
      role="list"
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
      data-testid="service-catalog-grid"
    >
      {services.map((s) => (
        <li
          key={s.id}
          data-testid="service-catalog-card"
          data-service-id={s.id}
          className="card flex flex-col gap-2"
        >
          <header className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
              <Server className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold leading-tight">{s.name}</h3>
              <p className="font-mono text-[10px] text-forge-300">
                {s.repo} · {s.language}
              </p>
            </div>
          </header>
          <Badge variant="outline" className="self-start text-[10px]">
            {s.loc.toLocaleString()} LOC
          </Badge>
        </li>
      ))}
    </ul>
  );
}
