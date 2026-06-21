'use client';

import * as React from 'react';
import { Bot, Calendar, Hash, Sparkles, X } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { Agent } from '@/lib/agent-center/data';

export interface AgentDetailPanelProps {
  agent: Agent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentDetailPanel({ agent, open, onOpenChange }: AgentDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-xl"
        data-testid="agent-detail-panel"
      >
        {agent ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
                  <Bot className="h-4 w-4" aria-hidden="true" />
                </span>
                <SheetTitle>{agent.name}</SheetTitle>
              </div>
              <SheetDescription>
                <span className="font-mono text-xs">v{agent.version}</span>
                {' · '}
                <span className="capitalize">{agent.type}</span>
                {' · '}
                <span
                  className="capitalize"
                  data-testid="agent-detail-status"
                  data-status={agent.status}
                >
                  {agent.status}
                </span>
              </SheetDescription>
            </SheetHeader>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Description
              </h3>
              <p className="text-sm text-forge-100">{agent.description}</p>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Identity
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-forge-300 inline-flex items-center gap-1">
                  <Hash className="h-3 w-3" aria-hidden="true" />
                  ID
                </dt>
                <dd className="font-mono text-forge-100">{agent.id}</dd>
                <dt className="text-forge-300 inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Default provider
                </dt>
                <dd className="font-mono text-forge-100">{agent.defaultProvider}</dd>
                <dt className="text-forge-300 inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  Last invoked
                </dt>
                <dd className="font-mono text-forge-100">{agent.lastInvokedAt}</dd>
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Supported tasks
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {agent.supportedTasks.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-forge-300">
                Usage (24h)
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-forge-300">Invocations</dt>
                <dd className="font-mono text-forge-100">
                  {agent.invocations24h.toLocaleString()}
                </dd>
                <dt className="text-forge-300">Cost</dt>
                <dd className="font-mono text-forge-100">
                  ${agent.costUsd24h.toFixed(2)}
                </dd>
              </dl>
            </section>

            <div className="mt-auto flex items-center justify-end pt-4">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 text-xs text-forge-300 hover:text-forge-100"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Close
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-forge-300">
            Select an agent to view details.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
