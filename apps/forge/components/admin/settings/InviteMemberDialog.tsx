'use client';

/**
 * Settings — Invite Member dialog.
 *
 * Opened by the Members tab. Collects an email + role, submits via
 * `useInviteMember`, and surfaces a toast on success. The mutation
 * hook invalidates the members query key so the new invitation
 * row appears in the table without a manual refresh.
 *
 * Role list is fetched from `useRoles()` — the role `<Select>` is
 * disabled until the list loads.
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
import { Skeleton } from '@/components/ui/skeleton';
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

import { useInviteMember, useRoles } from '@/lib/hooks/useSettings';
import {
  inviteMemberSchema,
  type InviteMemberForm,
} from '@/lib/settings/schemas';

export interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({ open, onOpenChange }: InviteMemberDialogProps) {
  const rolesQuery = useRoles();
  const invite = useInviteMember();
  const { toast } = useToast();

  const form = useZodForm<typeof inviteMemberSchema, InviteMemberForm>(inviteMemberSchema, {
    defaultValues: { email: '', roleId: '' },
  });

  // Reset on close so a re-open starts clean.
  React.useEffect(() => {
    if (!open) form.reset({ email: '', roleId: '' });
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values: InviteMemberForm) => {
    try {
      const result = await invite.mutateAsync({
        email: values.email,
        roleId: values.roleId,
      });
      toast({
        title: 'Invitation sent',
        description: result.token
          ? `${values.email} invited. Accept link: ${result.token}`
          : `${values.email} invited.`,
        variant: 'default',
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Invite failed',
        description: err instanceof Error ? err.message : 'Unknown error.',
        variant: 'destructive',
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="invite-member-dialog">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Send an invitation to a developer. They will receive a token
            to accept and join this project.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id="invite-member-form"
            onSubmit={onSubmit}
            className="grid gap-4"
            data-testid="invite-member-form"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="developer@example.com"
                      autoComplete="off"
                      data-testid="invite-email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  {rolesQuery.isLoading ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="invite-role">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(rolesQuery.data ?? []).map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

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
            form="invite-member-form"
            disabled={invite.isPending}
            data-testid="invite-submit"
          >
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
