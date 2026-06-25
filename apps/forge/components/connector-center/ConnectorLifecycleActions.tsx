'use client';

/**
 * ConnectorLifecycleActions — the Rotate / Test action footer
 * for the Connector Center detail panel (FORA-580, Phase 4).
 *
 * This is the only client-only piece of the detail panel; the rest
 * of `<ConnectorDetailPanel>` stays server-rendered. The footer is
 * extracted into its own component so the rest of the panel can keep
 * its `'use client'`-free contract (it currently uses the typed
 * `McpConnector` shape and redaction-only audit feed directly).
 *
 * Two real actions:
 *   - "Test connection" — runs the live reachability probe via
 *     `useTestConnector` and shows a `data-testid="connector-test-button"`
 *     success/error pill.
 *   - "Rotate credential" — opens a shadcn `Dialog` (Phase 4 wires the
 *     real modal per FORA-580). The modal accepts a single-line
 *     credential value (treated as `new_credentials.value`) and a
 *     free-form `config` JSON object so the shape matches
 *     `Record<string, unknown>`.
 *
 * On success the detail page should refetch — Phase 4 also passes
 * `onAfterRotate` / `onAfterTest` callbacks so the parent page can
 * call `router.refresh()` or trigger its own query invalidation. The
 * defaults are no-ops so the component stays drop-in for tests.
 */

import * as React from 'react';
import { CheckCircle2, Loader2, RotateCw, Zap } from 'lucide-react';

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
import { useToast } from '@/hooks/use-toast';
import {
  useRotateConnector,
  useTestConnector,
} from '@/lib/hooks/useConnectorLifecycle';

export interface ConnectorLifecycleActionsProps {
  readonly connectorId: string;
  readonly displayName: string;
  /** Called after a successful rotate or test so the parent can refetch. */
  readonly onAfterRotate?: () => void;
  readonly onAfterTest?: () => void;
}

/**
 * Phase 4 footer — the FORA-580 destructive action lands here, plus
 * the new "Test connection" button. The Rotate button is
 * `disabled={false}` (it was disabled in the previous placeholder);
 * Test connection is a non-destructive read.
 */
export function ConnectorLifecycleActions({
  connectorId,
  displayName,
  onAfterRotate,
  onAfterTest,
}: ConnectorLifecycleActionsProps) {
  const { toast } = useToast();
  const testMutation = useTestConnector(connectorId);
  const rotateMutation = useRotateConnector(connectorId);
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [newCredential, setNewCredential] = React.useState('');

  const handleTest = React.useCallback(async () => {
    try {
      const result = await testMutation.mutateAsync();
      toast({
        title: 'Connection OK',
        description: result.detail ?? `Tested in ${result.latency_ms} ms.`,
        variant: 'default',
      });
      onAfterTest?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed.';
      toast({
        title: 'Test failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [testMutation, toast, onAfterTest]);

  const handleRotate = React.useCallback(async () => {
    if (newCredential.trim().length === 0) return;
    try {
      await rotateMutation.mutateAsync({
        new_credentials: { value: newCredential },
      });
      toast({
        title: 'Credential rotated',
        description: `New credential for ${displayName} is active.`,
        variant: 'default',
      });
      setRotateOpen(false);
      setNewCredential('');
      onAfterRotate?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rotate failed.';
      toast({
        title: 'Rotate failed',
        description: message,
        variant: 'destructive',
      });
    }
  }, [rotateMutation, newCredential, toast, displayName, onAfterRotate]);

  const isTestPending = testMutation.isPending;
  const isRotatePending = rotateMutation.isPending;

  return (
    <div className="flex items-center gap-2" data-testid="connector-lifecycle-actions">
      {/* Test connection — non-destructive read */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={isTestPending}
        aria-label={`Test connection to ${displayName}`}
        data-testid="connector-test-button"
        data-connector-id={connectorId}
      >
        {isTestPending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <Zap className="h-3 w-3" aria-hidden="true" />
        )}
        {isTestPending ? 'Testing…' : 'Test connection'}
      </Button>

      {testMutation.isSuccess && testMutation.data ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300"
          data-testid="connector-test-success"
          data-latency-ms={testMutation.data.latency_ms}
        >
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          {testMutation.data.latency_ms} ms
        </span>
      ) : null}

      {/* Rotate credential — destructive, opens a confirmation modal */}
      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Rotate ${displayName} credential`}
            className="inline-flex items-center gap-1 rounded-sm border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-rose-300 hover:bg-rose-500/20"
            data-testid="connector-rotate-button"
            data-connector-id={connectorId}
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            Rotate credential
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rotate credential</DialogTitle>
            <DialogDescription>
              The new credential will replace the active one for{' '}
              <span className="font-mono">{displayName}</span>. The old
              value is invalidated immediately.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRotate();
            }}
            className="space-y-3"
            data-testid="connector-rotate-form"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="connector-rotate-value">New credential</Label>
              <Input
                id="connector-rotate-value"
                type="password"
                autoComplete="off"
                value={newCredential}
                onChange={(e) => setNewCredential(e.target.value)}
                placeholder="Paste the new secret"
                data-testid="connector-rotate-input"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRotateOpen(false)}
                data-testid="connector-rotate-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isRotatePending || newCredential.trim().length === 0}
                data-testid="connector-rotate-submit"
              >
                {isRotatePending ? 'Rotating…' : 'Rotate'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
