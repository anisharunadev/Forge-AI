'use client';

/**
 * NewRunDialog — modal launched from the Runs Center page header.
 *
 * Collects `{project_id, initial_context}` and submits via
 * `useCreateRun()`. On success, closes the dialog and routes the
 * operator to `/runs/{newId}`. Mirrors the `IdeaIntakeDialog`
 * pattern in `apps/forge/components/ideation/`.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useCreateRun } from '@/lib/hooks/useRuns';

export function NewRunDialog() {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [projectId, setProjectId] = React.useState('project-forge-demo');
  const [initialContext, setInitialContext] = React.useState('');

  const create = useCreateRun();

  const canSubmit = projectId.trim().length > 0 && !create.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const run = await create.mutateAsync({
        project_id: projectId.trim(),
        ...(initialContext.trim() ? { initial_context: initialContext.trim() } : {}),
      });
      toast({ title: 'Run created', description: `Routing to ${run.id}…` });
      setOpen(false);
      setInitialContext('');
      router.push(`/runs/${run.id}`);
    } catch (err) {
      toast({
        title: 'Failed to create run',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="runs-new-button">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New run
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="runs-new-dialog">
        <DialogHeader>
          <DialogTitle>Start a new run</DialogTitle>
          <DialogDescription>
            Creates a new run with all seven canonical stages (ideation → docs). The run
            starts in `created` state and the ideation agent picks it up.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="run-project">Project ID</Label>
            <Input
              id="run-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="project-forge-demo"
              required
              data-testid="runs-new-project-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="run-context">Initial context (optional)</Label>
            <textarea
              id="run-context"
              value={initialContext}
              onChange={(e) => setInitialContext(e.target.value)}
              placeholder="One sentence describing what this run should accomplish."
              rows={4}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="runs-new-context-input"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              data-testid="runs-new-cancel"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit} data-testid="runs-new-submit">
              {create.isPending ? 'Creating…' : 'Create run'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
