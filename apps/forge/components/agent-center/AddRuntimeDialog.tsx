'use client';

/**
 * Add Runtime dialog (step-54 — Phase 2).
 *
 * The backend exposes `POST /runtimes/start` rather than a generic
 * create — a runtime is created by starting one. This dialog picks
 * an agent + workspace path + kind and triggers the start.
 *
 * Skill rules adopted:
 *   - **Validation** — agent id + workspace path are required.
 *   - **Toast feedback** — success and error paths both surface.
 *   - **Cache invalidation** — `useStartRuntime` invalidates the
 *     runtimes list so the new handle appears immediately.
 */

import * as React from 'react';
import { Plus, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAgents, useStartRuntime, type RuntimeKind } from '@/lib/query/hooks';

const RUNTIME_KINDS: ReadonlyArray<{ value: RuntimeKind; label: string }> = [
  { value: 'local_subprocess', label: 'Local subprocess (sandbox)' },
  { value: 'kubernetes_pod', label: 'Kubernetes pod' },
];

interface FormState {
  agentId: string;
  workspacePath: string;
  kind: RuntimeKind;
}

const EMPTY: FormState = {
  agentId: '',
  workspacePath: '/workspace',
  kind: 'local_subprocess',
};

export function AddRuntimeDialog() {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);

  const { toast } = useToast();
  const startRuntime = useStartRuntime();
  const { data: agents } = useAgents();

  const enabledAgents = (agents ?? []).filter((a) => a.status === 'enabled');

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit =
    form.agentId.length > 0 && form.workspacePath.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await startRuntime.mutateAsync({
        agent_id: form.agentId,
        workspace_path: form.workspacePath.trim(),
        kind: form.kind,
      });
      toast({
        title: 'Runtime started',
        description: 'The new handle appears in the Runtimes tab.',
      });
      setForm(EMPTY);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Could not start runtime',
        description: message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="add-runtime-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Register Runtime
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Register a runtime</DialogTitle>
            <DialogDescription>
              Runtimes are execution environments. Pick an agent and a
              workspace to start a sandboxed runtime.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="runtime-agent">Agent</Label>
              <Select
                value={form.agentId}
                onValueChange={(v) => update('agentId', v)}
              >
                <SelectTrigger id="runtime-agent">
                  <SelectValue placeholder="Select an agent…" />
                </SelectTrigger>
                <SelectContent>
                  {enabledAgents.length === 0 ? (
                    <SelectItem value="" disabled>
                      No enabled agents — register one first.
                    </SelectItem>
                  ) : (
                    enabledAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} <span className="text-forge-300">· v{a.version}</span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="runtime-workspace">Workspace path</Label>
              <Input
                id="runtime-workspace"
                value={form.workspacePath}
                onChange={(e) => update('workspacePath', e.target.value)}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="runtime-kind">Kind</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => update('kind', v as RuntimeKind)}
              >
                <SelectTrigger id="runtime-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUNTIME_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={startRuntime.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || startRuntime.isPending || enabledAgents.length === 0}
              data-testid="add-runtime-submit"
            >
              <Server className="h-3.5 w-3.5" aria-hidden="true" />
              {startRuntime.isPending ? 'Starting…' : 'Start runtime'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}