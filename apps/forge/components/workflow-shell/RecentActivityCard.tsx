/**
 * RecentActivityCard — light activity feed on the workflow home page.
 *
 * The previous dashboard buried activity inside Mission Control. The
 * workflow shell surfaces the last few items here so the user can
 * see context (where they left off, what just shipped) without
 * leaving the home page.
 *
 * Empty state is handled in the parent so this component never has
 * to render "nothing to show" copy — it just renders an empty list
 * when no items are provided.
 */

import * as React from 'react';
import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getStage } from '@/lib/workflow-shell/stages';
import type { WorkflowActivityItem } from '@/lib/workflow-shell/types';

export interface RecentActivityCardProps {
  readonly items: ReadonlyArray<WorkflowActivityItem>;
  readonly className?: string;
}

function ActivityKindBadge({ kind }: { kind: WorkflowActivityItem['kind'] }) {
  const tone =
    kind === 'completed'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      : kind === 'blocked'
        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
        : 'bg-amber-500/10 text-amber-300 border-amber-500/30';
  const label = kind === 'completed' ? 'Done' : kind === 'blocked' ? 'Blocked' : 'Started';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function RecentActivityCard({ items, className }: RecentActivityCardProps) {
  return (
    <Card
      data-testid="workflow-recent-activity-card"
      className={cn('border-border bg-card text-card-foreground', className)}
    >
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
        <CardDescription>
          The last few events across the seven workflow stages.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? null : (
          <ul className="flex flex-col gap-2" data-testid="workflow-recent-activity-list">
            {items.map((item) => {
              const stage = getStage(item.stage);
              return (
                <li
                  key={item.id}
                  data-testid="workflow-activity-item"
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={stage.centerPath}
                      className="truncate font-medium hover:underline"
                    >
                      {item.summary}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {stage.label} · {new Date(item.occurredAt).toLocaleString()}
                    </span>
                  </div>
                  <ActivityKindBadge kind={item.kind} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}