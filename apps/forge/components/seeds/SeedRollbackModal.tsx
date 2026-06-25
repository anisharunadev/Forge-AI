'use client';

/**
 * SeedRollbackModal — undo the most recent apply (Plan H commit 4).
 *
 * `POST /seeds/{name}/rollback` is a simple verb with no body. The
 * confirmation modal exists to prevent accidental clicks on the
 * header — rolling back restores the pre-apply state, which means a
 * previously-clean tenant can end up with leftover rows if the apply
 * dropped and re-created something the operator did not expect.
 *
 * Mirrors the SeedApplyModal skeleton: trigger button, dialog, toast
 * on success, error surfaced inline. No form fields.
 */

import { useState } from 'react';
import { Undo2 } from 'lucide-react';

import { useRollbackSeed } from '@/lib/hooks/useSeeds';
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
import { useToast } from '@/hooks/use-toast';

export interface SeedRollbackModalProps {
  seedName: string;
}

export function SeedRollbackModal({ seedName }: SeedRollbackModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const rollback = useRollbackSeed(seedName);

  async function handleSubmit() {
    try {
      await rollback.mutateAsync();
      toast({
        title: 'Seed rolled back',
        description: `${seedName} reverted to the previous applied state.`,
      });
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Rollback failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="seed-rollback-trigger">
          <Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Rollback
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="seed-rollback-dialog">
        <DialogHeader>
          <DialogTitle>Rollback seed: {seedName}</DialogTitle>
          <DialogDescription>
            Undo the most recent apply. The database is restored to the
            state recorded in the previous <code>seed_runs</code> row. No
            data created outside the seed is affected.
          </DialogDescription>
        </DialogHeader>

        {rollback.error && (
          <div
            className="text-sm text-destructive"
            data-testid="seed-rollback-error"
          >
            Error: {rollback.error instanceof Error
              ? rollback.error.message
              : String(rollback.error)}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            data-testid="seed-rollback-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleSubmit}
            disabled={rollback.isPending}
            data-testid="seed-rollback-submit"
          >
            {rollback.isPending ? 'Rolling back…' : 'Rollback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}