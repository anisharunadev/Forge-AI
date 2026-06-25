'use client';

/**
 * Settings — Add Env Var dialog.
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

import { useCreateEnvVar } from '@/lib/hooks/useSettings';
import { envVarCreateSchema, type EnvVarCreateForm } from '@/lib/settings/schemas';

export interface AddEnvVarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddEnvVarDialog({ open, onOpenChange }: AddEnvVarDialogProps) {
  const create = useCreateEnvVar();
  const { toast } = useToast();

  const form = useZodForm(envVarCreateSchema, {
    defaultValues: { key: '', value: '', scope: 'all' },
  });

  React.useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values: EnvVarCreateForm) => {
    try {
      await create.mutateAsync({
        key: values.key,
        value: values.value,
        scope: values.scope as 'workflow' | 'agent' | 'all',
      });
      toast({ title: 'Variable created', variant: 'default' });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Create failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="add-envvar-dialog">
        <DialogHeader>
          <DialogTitle>Add environment variable</DialogTitle>
          <DialogDescription>
            Values are encrypted at rest and never returned in plaintext
            by the API — the value is only revealed in-session after
            an explicit reveal call.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="add-envvar-form"
            onSubmit={onSubmit}
            className="grid gap-4"
            data-testid="add-envvar-form"
          >
            <FormField
              control={form.control}
              name="key"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Key</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="API_TOKEN"
                      data-testid="envvar-key"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Value</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      data-testid="envvar-value"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="envvar-scope">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="workflow">Workflows only</SelectItem>
                      <SelectItem value="agent">Agents only</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-envvar-form"
            disabled={create.isPending}
            data-testid="envvar-submit"
          >
            {create.isPending ? 'Saving…' : 'Save variable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
