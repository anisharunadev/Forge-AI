'use client';

/**
 * Settings — Seeds tab.
 *
 * Lists seed prompts / templates with a usage count and a Run CTA.
 * Top-right "New seed" primary button opens a stub Dialog (the full
 * editor ships in Phase 1).
 */

import * as React from 'react';
import { Play, Plus, Sprout } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, SectionCard } from '@/components/shell';
import { useToast } from '@/hooks/use-toast';
import { useApplySeed, useSeeds } from '@/lib/hooks/useSettings';
import type { SeedManifestSummary } from '@/lib/settings/types';

interface Seed {
  id: string;
  name: string;
  description: string;
  // step 73: usageCount/updatedAt not in backend SeedManifestSummary — placeholder until seed telemetry lands
  usageCount: number | null;
  updatedAt: string | null;
}

function wireToSeed(wire: SeedManifestSummary): Seed {
  return {
    id: wire.name,
    name: wire.name,
    description: wire.description,
    usageCount: null,
    updatedAt: null,
  };
}

export function SeedsTab() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const seedsQ = useSeeds();
  const applyM = useApplySeed();

  const handleRun = (seed: Seed) => {
    applyM.mutate(
      { name: seed.id },
      {
        onSuccess: () =>
          toast({
            title: `Ran ${seed.name}`,
            description: 'The seed has been dispatched to the agent runtime.',
          }),
        onError: (e) =>
          toast({
            title: `Failed to run ${seed.name}`,
            description: e.message,
          }),
      },
    );
  };

  const seeds: ReadonlyArray<Seed> = (seedsQ.data ?? []).map(wireToSeed);
  const runningName = applyM.isPending ? applyM.variables?.name ?? null : null;

  return (
    <SectionCard
      title="Seeds"
      description="Reusable prompt templates the agent runtime can dispatch on demand or on a schedule."
      headerRight={
        <Button
          type="button"
          onClick={() => setCreateOpen(true)}
          data-testid="seeds-new"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          New seed
        </Button>
      }
    >
      {seedsQ.isLoading ? (
        <div className="space-y-3" aria-label="Seeds">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : seeds.length === 0 ? (
        <EmptyState
          icon={<Sprout className="h-5 w-5" aria-hidden="true" />}
          title="No seeds yet"
          description="Create a reusable prompt template to make recurring agent workflows one click away."
          testId="seeds-empty"
        />
      ) : (
        <ul className="space-y-3" aria-label="Seeds">
          {seeds.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              data-testid={`seed-row-${s.id}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-[var(--text-sm)] font-medium text-[var(--fg-primary)]">
                  {s.name}
                </p>
                <p className="line-clamp-2 text-[var(--text-xs)] text-[var(--fg-secondary)]">
                  {s.description}
                </p>
                <p className="font-mono text-[11px] text-[var(--fg-tertiary)]">
                  {/* step 73: usageCount/updatedAt not in backend SeedManifestSummary — placeholder until seed telemetry lands */}
                  {s.usageCount ?? '—'} runs · updated {s.updatedAt ?? '—'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => handleRun(s)}
                disabled={runningName === s.id}
                data-testid={`seed-run-${s.id}`}
              >
                <Play
                  className={
                    runningName === s.id
                      ? 'h-3.5 w-3.5 animate-spin'
                      : 'h-3.5 w-3.5'
                  }
                  aria-hidden="true"
                />
                {runningName === s.id ? 'Running…' : 'Run'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="seeds-new-dialog">
          <DialogHeader>
            <DialogTitle>New seed</DialogTitle>
            <DialogDescription>
              A seed is a named, reusable prompt the agent runtime can
              dispatch. The full template editor ships in Phase 1.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[var(--text-xs)] font-medium text-[var(--fg-secondary)]">
                Name <span className="text-[var(--accent-rose)]">*</span>
              </span>
              <Input
                placeholder="e.g. Weekly status digest"
                data-testid="seeds-new-name"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[var(--text-xs)] font-medium text-[var(--fg-secondary)]">
                Description
              </span>
              <Textarea
                placeholder="What does this seed do?"
                className="min-h-20"
                data-testid="seeds-new-description"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              data-testid="seeds-new-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setCreateOpen(false);
                toast({
                  title: 'Seed draft created',
                  description: 'Editor opens in Phase 1.',
                });
              }}
              data-testid="seeds-new-confirm"
            >
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}