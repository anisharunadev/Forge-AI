'use client';

/**
 * Register Agent dialog (step-54 — Phase 2).
 *
 * Replaces the previous local-state placeholder with a real form
 * that posts to `POST /agents` via `useCreateAgent`. Provider +
 * model selection comes from the live `useProviders` query.
 *
 * Skill rules adopted:
 *   - **Validation** — name is required; on submit, the agent type
 *     must be one of the backend enum values (claude_code, codex,
 *     gemini, custom). The UI labels are friendly; the API payload
 *     is the backend enum.
 *   - **Toast on every action** — success and error paths both
 *     surface a toast so the user always knows what happened.
 *   - **Cache invalidation** — `useCreateAgent` invalidates the
 *     agents list automatically; the new agent appears without a
 *     manual refresh.
 */

import * as React from 'react';
import { Plus } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateAgent,
  useProviders,
  type AgentBackendType,
} from '@/lib/query/hooks';

const AGENT_TYPES: ReadonlyArray<{ value: AgentBackendType; label: string }> = [
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'custom', label: 'Custom' },
];

interface FormState {
  name: string;
  type: AgentBackendType;
  version: string;
  description: string;
  providerId: string;
}

const EMPTY: FormState = {
  name: '',
  type: 'claude_code',
  version: '1.0.0',
  description: '',
  providerId: '',
};

export interface CreateAgentDialogProps {
  /** Optional default provider id (e.g. from a wizard pre-fill). */
  defaultProviderId?: string;
}

export function CreateAgentDialog({ defaultProviderId }: CreateAgentDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);

  const { toast } = useToast();
  const createAgent = useCreateAgent();
  const { data: providers } = useProviders();

  const enabledProviders = (providers ?? []).filter((p) => p.enabled);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit =
    form.name.trim().length > 0 && form.version.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await createAgent.mutateAsync({
        name: form.name.trim(),
        type: form.type,
        version: form.version.trim(),
        capabilities: form.description.trim()
          ? { description: form.description.trim(), tasks: ['general'] }
          : { tasks: ['general'] },
      });
      toast({
        title: `Agent "${form.name.trim()}" registered`,
        description: 'It now appears in the Agents tab.',
      });
      setForm(EMPTY);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Could not register agent',
        description: message,
        variant: 'destructive',
      });
    }
  };

  // Apply default provider once providers load (e.g. from a wizard pre-fill).
  React.useEffect(() => {
    if (defaultProviderId && !form.providerId) {
      update('providerId', defaultProviderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProviderId, providers]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="create-agent-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Register Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Register a new agent</DialogTitle>
            <DialogDescription>
              Agents run inside Forge runtimes. Choose a name, type, and
              version. Providers can be attached later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Refactor Agent"
                required
                data-testid="create-agent-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="agent-type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => update('type', v as AgentBackendType)}
                >
                  <SelectTrigger id="agent-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="agent-version">Version</Label>
                <Input
                  id="agent-version"
                  value={form.version}
                  onChange={(e) => update('version', e.target.value)}
                  required
                  data-testid="create-agent-version"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="agent-provider">Default provider (optional)</Label>
              <Select
                value={form.providerId}
                onValueChange={(v) => update('providerId', v)}
              >
                <SelectTrigger id="agent-provider">
                  <SelectValue placeholder="Select a provider…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No provider</SelectItem>
                  {enabledProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.litellm_model_alias})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {enabledProviders.length === 0 ? (
                <p className="text-[11px] text-[var(--fg-tertiary)]">
                  No providers configured yet. Add one in the Model
                  Providers tab.
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="agent-description">Description</Label>
              <Textarea
                id="agent-description"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="What does this agent do?"
                rows={3}
                data-testid="create-agent-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createAgent.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || createAgent.isPending}
              data-testid="create-agent-submit"
            >
              {createAgent.isPending ? 'Registering…' : 'Register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}