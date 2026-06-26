'use client';

/**
 * Settings — Edit Agent Config dialog.
 *
 * Per-project agent runtime config: system prompt, temperature, max
 * tokens, model provider, model alias. Saves via
 * `useUpdateAgentConfig`, which invalidates the agent config query
 * key and the audit query key on success.
 *
 * The model provider <Select> is populated from `useProviders()` so
 * the user can wire an agent to any LLM provider the tenant has
 * configured.
 */

import * as React from 'react';

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
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@/components/forms';

import {
  useAgentConfig,
  useProviders,
  useUpdateAgentConfig,
} from '@/lib/hooks/useSettings';
import {
  agentConfigSchema,
  type AgentConfigForm,
} from '@/lib/settings/schemas';

export interface EditAgentConfigDialogProps {
  agentId: string | null;
  agentName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NONE_PROVIDER = '__none__';

export function EditAgentConfigDialog({
  agentId,
  agentName,
  open,
  onOpenChange,
}: EditAgentConfigDialogProps) {
  const configQuery = useAgentConfig(agentId ?? '');
  const providersQuery = useProviders();
  const update = useUpdateAgentConfig();
  const { toast } = useToast();

  const form = useZodForm<typeof agentConfigSchema, AgentConfigForm>(agentConfigSchema, {
    defaultValues: {
      systemPrompt: '',
      temperature: 0,
      maxTokens: 0,
      modelProviderId: '',
      modelAlias: '',
    },
  });

  // Re-sync when the agent config loads.
  React.useEffect(() => {
    if (!open || !configQuery.data) return;
    form.reset({
      systemPrompt: configQuery.data.systemPrompt ?? '',
      temperature: configQuery.data.temperature ?? 0,
      maxTokens: configQuery.data.maxTokens ?? 0,
      modelProviderId: configQuery.data.modelProviderId ?? '',
      modelAlias: configQuery.data.modelAlias ?? '',
    });
  }, [open, configQuery.data, form]);

  const onSubmit = form.handleSubmit(async (values: AgentConfigForm) => {
    if (!agentId) return;
    try {
      await update.mutateAsync({
        agentId,
        body: {
          systemPrompt: values.systemPrompt || null,
          temperature: values.temperature || null,
          maxTokens: values.maxTokens || null,
          modelProviderId: values.modelProviderId || null,
          modelAlias: values.modelAlias || null,
        },
      });
      toast({
        title: 'Agent config updated',
        description: 'The change is recorded in the audit log.',
        variant: 'default',
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="edit-agent-config-dialog">
        <DialogHeader>
          <DialogTitle>
            {agentName ? `Configure ${agentName}` : 'Configure agent'}
          </DialogTitle>
          <DialogDescription>
            Set the per-project runtime config for this agent.
          </DialogDescription>
        </DialogHeader>

        {configQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Form {...form}>
            <form
              id="edit-agent-config-form"
              onSubmit={onSubmit}
              className="grid gap-4"
              data-testid="edit-agent-config-form"
            >
              <FormField
                control={form.control}
                name="systemPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>System prompt</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="You are a careful code reviewer…"
                        className="min-h-28"
                        data-testid="agent-system-prompt"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Temperature</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-3">
                          <Slider
                            value={[field.value ?? 0]}
                            min={0}
                            max={2}
                            step={0.1}
                            onValueChange={(v) => field.onChange(v[0] ?? 0)}
                            data-testid="agent-temperature"
                          />
                          <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">
                            {(field.value ?? 0).toFixed(1)}
                          </span>
                        </div>
                      </FormControl>
                      <FormDescription>0 = deterministic, 2 = creative.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxTokens"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max tokens</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="4096"
                          data-testid="agent-max-tokens"
                          value={field.value ?? 0}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="modelProviderId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model provider</FormLabel>
                      <Select
                        value={field.value || NONE_PROVIDER}
                        onValueChange={(v) => field.onChange(v === NONE_PROVIDER ? '' : v)}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="agent-provider">
                            <SelectValue placeholder="Select a provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE_PROVIDER}>
                            <span className="text-muted-foreground">No provider</span>
                          </SelectItem>
                          {(providersQuery.data ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({p.type})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="modelAlias"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model alias</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="claude-sonnet-4.6"
                          data-testid="agent-model-alias"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        LiteLLM model alias to dispatch against.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </form>
          </Form>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-agent-config-form"
            disabled={update.isPending}
            data-testid="agent-config-save"
          >
            {update.isPending ? 'Saving…' : 'Save config'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
