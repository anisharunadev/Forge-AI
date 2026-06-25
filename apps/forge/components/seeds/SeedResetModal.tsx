'use client';

/**
 * SeedResetModal — drop existing seed data and re-apply the manifest
 * (Plan H commit 3).
 *
 * The scope selector gates how aggressive the reset is:
 *   - `demo_only` (default) — drops rows where `is_demo = true`, then
 *     re-applies. Recommended for the common "redo the demo" flow.
 *   - `all` — drops all rows for the seed, including non-demo data.
 *     Requires `forge:admin` or `steward` permission at the API layer;
 *     the destructive warning banner makes that obvious in the UI.
 *
 * The warning banner is rendered conditionally and uses the
 * `destructive` semantic colour so it reads as a real alert, not a
 * hint. The destructive button stays disabled while the mutation is
 * in flight so a double-click cannot double-fire.
 */

import { useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { useResetSeed } from '@/lib/hooks/useSeeds';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { SeedResetScope } from '@/lib/seeds/types';

export interface SeedResetModalProps {
  seedName: string;
}

export function SeedResetModal({ seedName }: SeedResetModalProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<SeedResetScope>('demo_only');
  const reset = useResetSeed(seedName);

  async function handleSubmit() {
    try {
      await reset.mutateAsync({ scope });
      toast({
        title: 'Seed reset',
        description: `${seedName} reset (scope=${scope}).`,
      });
      setOpen(false);
    } catch (err) {
      toast({
        title: 'Reset failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" data-testid="seed-reset-trigger">
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Reset
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="seed-reset-dialog">
        <DialogHeader>
          <DialogTitle>Reset seed: {seedName}</DialogTitle>
          <DialogDescription>
            Drops existing seed data and re-applies the manifest. Production
            data is not touched unless scope is set to <code>all</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seed-reset-scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as SeedResetScope)}
            >
              <SelectTrigger
                id="seed-reset-scope"
                data-testid="seed-reset-scope-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="demo_only">
                  Demo only (recommended)
                </SelectItem>
                <SelectItem value="all">
                  All rows including non-demo (Steward only)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === 'all' && (
            <div
              className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-3 text-sm"
              data-testid="seed-reset-warning"
              role="alert"
            >
              <AlertTriangle
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive"
                aria-hidden="true"
              />
              <div>
                This will drop <strong>all</strong> rows for this seed,
                including non-demo data. Requires <code>forge:admin</code>{' '}
                or <code>steward</code> permission.
              </div>
            </div>
          )}

          {reset.error && (
            <div
              className="text-sm text-destructive"
              data-testid="seed-reset-error"
            >
              Error: {reset.error instanceof Error
                ? reset.error.message
                : String(reset.error)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            data-testid="seed-reset-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleSubmit}
            disabled={reset.isPending}
            data-testid="seed-reset-submit"
          >
            {reset.isPending ? 'Resetting…' : 'Reset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}