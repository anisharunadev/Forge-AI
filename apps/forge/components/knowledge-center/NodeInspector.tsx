'use client';

import * as React from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { FreshnessBadge } from './FreshnessBadge';
import type { KGEdge, KGNode } from '@/lib/knowledge-center/data';

export interface NodeInspectorProps {
  node: KGNode | null;
  edges: ReadonlyArray<KGEdge>;
  allNodes: ReadonlyArray<KGNode>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NodeInspector({
  node,
  edges,
  allNodes,
  open,
  onOpenChange,
}: NodeInspectorProps) {
  const incident = React.useMemo(() => {
    if (!node) return { in: [], out: [] };
    const inEdges = edges.filter((e) => e.target === node.id);
    const outEdges = edges.filter((e) => e.source === node.id);
    return { in: inEdges, out: outEdges };
  }, [edges, node]);

  const labelOf = (id: string) => allNodes.find((n) => n.id === id)?.label ?? id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md"
        data-testid="node-inspector"
      >
        {node ? (
          <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
            <SheetHeader>
              <SheetTitle>{node.label}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-xs">{node.kind}</span> ·{' '}
                <span className="font-mono text-xs">{node.id}</span>
              </SheetDescription>
            </SheetHeader>

            <FreshnessBadge updatedAt={node.updatedAt} />

            <Separator />

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Outgoing ({incident.out.length})
              </h3>
              {incident.out.length === 0 ? (
                <p className="text-xs text-forge-400">No outgoing edges.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm" data-testid="node-out-edges">
                  {incident.out.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-sm border border-forge-700/40 bg-forge-900/40 px-2 py-1 text-xs"
                    >
                      <span className="font-mono">{e.kind}</span>
                      <span className="text-forge-100">{labelOf(e.target)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-forge-300">
                Incoming ({incident.in.length})
              </h3>
              {incident.in.length === 0 ? (
                <p className="text-xs text-forge-400">No incoming edges.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm" data-testid="node-in-edges">
                  {incident.in.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded-sm border border-forge-700/40 bg-forge-900/40 px-2 py-1 text-xs"
                    >
                      <span className="text-forge-100">{labelOf(e.source)}</span>
                      <span className="font-mono">{e.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
