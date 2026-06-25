'use client';

/**
 * SeedApplyModal — trigger a `POST /seeds/{name}/apply` mutation
 * (Plan H commit 2).
 *
 * Follows the `NewRunDialog` pattern: Dialog wrapper around a form,
 * `useApplySeed` mutation hook, pending/error states surfaced inline,
 * toast on success, dialog close on success.
 *
 * The modal exposes a single opt-in checkbox — `allow_in_prod` — which
 * the backend's `production_safety` guard requires when the seed's
 * manifest is not `production_safe`. Defaults to false so the
 * non-prod happy path is one click.
 *
 * RBAC enforcement lives server-side in the Plan C endpoint
 * (`seeds:manage`). The UI does not gate the button here; the
 * `useApplySeed` mutation will surface a 403 via `apply.error` and the
 * dialog remains open so the operator can read the message.
 */

import { useState } from 'react';

import { useApplySeed } from '@/lib/hooks/useSeeds';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export interface SeedApplyModalProps {
  seedName: string;
}

export function SeedApplyModal({ seedName }: SeedApplyModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [allowInProd, setAllowInProd] = useState(false);
  const apply = useApplySeed(seedName);

  async function handleSubmit() {
    try {
      await apply.mutateAsync({ allow_in_prod: allowInProd });
      toast({
        title: 'Seed applied',
        description: `${seedName} re-applied successfully.`,
      });
      setOpen(false);
      setAllowInProd(false);
    } catch (err) {
      toast({
        title: 'Apply failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="seed-apply-trigger">
          <Play className="mr-2 h-4 w-4" aria-hidden="true" />
          Apply seed
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="seed-apply-dialog">
        <DialogHeader>
          <DialogTitle>Apply seed: {seedName}</DialogTitle>
          <DialogDescription>
            Idempotent operation — existing rows with matching natural
            keys are upserted. Production environments are refused unless
            the manifest is `production_safe` or this checkbox is enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start space-x-2">
            <Checkbox
              id="allow-in-prod"
              checked={allowInProd}
              onCheckedChange={(checked) => setAllowInProd(checked === true)}
              data-testid="seed-apply-allow-prod"
            />
            <div className="grid gap-1.5 leading-none">
              <Label htmlFor="allow-in-prod">Allow in production</Label>
              <p className="text-xs text-muted-foreground">
                Use with caution. Records a permission-flagged audit entry.
              </p>
            </div>
          </div>

          {apply.error && (
            <div
              className="text-sm text-destructive"
              data-testid="seed-apply-error"
            >
              Error: {apply.error instanceof Error
                ? apply.error.message
                : String(apply.error)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            data-testid="seed-apply-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={apply.isPending}
            data-testid="seed-apply-submit"
          >
            {apply.isPending ? 'Applying…' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}