'use client';

/**
 * Add Provider dialog (step-54 — Phase 2).
 *
 * Form for `POST /model-providers`. Captures the friendly name,
 * backend type, LiteLLM model alias, and an API key (stored on the
 * backend in the provider's `config` — never sent in plaintext from
 * this client more than once).
 *
 * Skill rules adopted:
 *   - **Validation** — name + alias + api_key are required.
 *   - **Toast feedback** — success and error paths both surface.
 *   - **Cache invalidation** — `useCreateProvider` invalidates the
 *     providers list so the new entry appears immediately.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  useCreateProvider,
  type ModelProviderBackendType,
} from '@/lib/query/hooks';

const PROVIDER_TYPES: ReadonlyArray<{ value: ModelProviderBackendType; label: string }> = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
  { value: 'custom', label: 'Custom (OpenAI-compatible)' },
];

interface FormState {
  name: string;
  type: ModelProviderBackendType;
  litellmModelAlias: string;
  apiKey: string;
  rateLimitRpm: string;
}

const EMPTY: FormState = {
  name: '',
  type: 'anthropic',
  litellmModelAlias: 'claude-3-5-sonnet',
  apiKey: '',
  rateLimitRpm: '',
};

export function AddProviderDialog() {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY);

  const { toast } = useToast();
  const createProvider = useCreateProvider();

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const canSubmit =
    form.name.trim().length > 0 &&
    form.litellmModelAlias.trim().length > 0 &&
    form.apiKey.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await createProvider.mutateAsync({
        name: form.name.trim(),
        type: form.type,
        litellm_model_alias: form.litellmModelAlias.trim(),
        config: { api_key: form.apiKey.trim() },
        rate_limit_rpm: form.rateLimitRpm
          ? Number.parseInt(form.rateLimitRpm, 10) || 0
          : 0,
        enabled: true,
      });
      toast({
        title: `Provider "${form.name.trim()}" added`,
        description: 'Test the connection to verify it.',
      });
      setForm(EMPTY);
      setOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: 'Could not add provider',
        description: message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="add-provider-trigger">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a model provider</DialogTitle>
            <DialogDescription>
              Forge routes agent traffic through LiteLLM Proxy. Pick a
              provider type and paste your API key.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="e.g. Production Anthropic"
                required
                data-testid="add-provider-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="provider-type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => update('type', v as ModelProviderBackendType)}
                >
                  <SelectTrigger id="provider-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="provider-alias">LiteLLM model alias</Label>
                <Input
                  id="provider-alias"
                  value={form.litellmModelAlias}
                  onChange={(e) => update('litellmModelAlias', e.target.value)}
                  required
                  data-testid="add-provider-alias"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="provider-key">API key</Label>
              <Input
                id="provider-key"
                type="password"
                value={form.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                placeholder="sk-…"
                required
                data-testid="add-provider-key"
                autoComplete="off"
              />
              <p className="text-[11px] text-[var(--fg-tertiary)]">
                Stored server-side in the provider config. Used by
                LiteLLM Proxy to route traffic.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="provider-rpm">Rate limit (RPM, optional)</Label>
              <Input
                id="provider-rpm"
                type="number"
                min={0}
                value={form.rateLimitRpm}
                onChange={(e) => update('rateLimitRpm', e.target.value)}
                placeholder="0 = unlimited"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createProvider.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || createProvider.isPending}
              data-testid="add-provider-submit"
            >
              {createProvider.isPending ? 'Adding…' : 'Add provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}