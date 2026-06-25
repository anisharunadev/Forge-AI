'use client';

/**
 * Settings — Add Provider dialog.
 * Compact implementation: form with name/type/config/alias/rate-limits.
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@/components/forms';

import { useCreateProvider } from '@/lib/hooks/useSettings';
import {
  providerCreateSchema,
  type ProviderCreateForm,
} from '@/lib/settings/schemas';

export interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProviderDialog({ open, onOpenChange }: AddProviderDialogProps) {
  const create = useCreateProvider();
  const { toast } = useToast();

  const form = useZodForm(providerCreateSchema, {
    defaultValues: {
      name: '',
      type: 'anthropic',
      config: '{}',
      litellmModelAlias: '',
      rateLimitRpm: 0,
      rateLimitTpm: 0,
    },
  });

  React.useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values: ProviderCreateForm) => {
    try {
      let parsedConfig: Record<string, unknown>;
      try {
        parsedConfig = JSON.parse(values.config) as Record<string, unknown>;
      } catch {
        toast({ title: 'Invalid JSON in config', variant: 'destructive' });
        return;
      }
      await create.mutateAsync({
        name: values.name,
        type: values.type,
        config: parsedConfig,
        litellmModelAlias: values.litellmModelAlias || undefined,
        rateLimitRpm: values.rateLimitRpm || undefined,
        rateLimitTpm: values.rateLimitTpm || undefined,
      });
      toast({ title: 'Provider added', variant: 'default' });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Add failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-provider-dialog">
        <DialogHeader>
          <DialogTitle>Add LLM provider</DialogTitle>
          <DialogDescription>
            Register a new model provider for this tenant.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="add-provider-form"
            onSubmit={onSubmit}
            className="grid gap-4"
            data-testid="add-provider-form"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Anthropic prod" data-testid="provider-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="provider-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                      <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="config"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Config (JSON)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='{"api_key": "..."}'
                      className="min-h-24 font-mono text-xs"
                      data-testid="provider-config"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="litellmModelAlias"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>LiteLLM model alias</FormLabel>
                  <FormControl>
                    <Input placeholder="claude-sonnet-4.6" data-testid="provider-alias" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="rateLimitRpm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate limit (RPM)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="60"
                        data-testid="provider-rpm"
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rateLimitTpm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate limit (TPM)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="100000"
                        data-testid="provider-tpm"
                        value={field.value ?? 0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-provider-form"
            disabled={create.isPending}
            data-testid="provider-submit"
          >
            {create.isPending ? 'Adding…' : 'Add provider'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
