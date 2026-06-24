'use client';

/**
 * DemoLoader — `/welcome` "Load Demo (Acme Corp)" client component
 * (Plan G commit 1).
 *
 * Posts `apply` to `/api/v1/seeds/acme-corp`, polls `status` every
 * 2s until `applied === true`, then `router.push('/dashboard')`.
 *
 * During apply, the button shows a spinner + progress copy. Errors
 * surface inline; the user can retry without leaving the page.
 *
 * The Acme seed runs entirely client-side; the orchestrator handles
 * apply on the backend (`backend/app/api/v1/seeds.py`).
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useApplySeed, useSeedStatus } from '@/lib/hooks/useSeeds';

const DEMO_SEED = 'acme-corp';

type Phase = 'idle' | 'applying' | 'polling' | 'error';

export function DemoLoader() {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const apply = useApplySeed(DEMO_SEED);

  // Poll while polling phase is active. We drive this from a phase flag
  // instead of the hook's `refetchInterval` so the button can show
  // "Polling for applied..." copy until the backend reports success.
  const status = useSeedStatus(DEMO_SEED, {
    refetchInterval: phase === 'polling' ? 2_000 : undefined,
  });

  // Auto-redirect once applied during polling.
  React.useEffect(() => {
    if (phase !== 'polling') return;
    if (status.data?.applied) {
      setPhase('idle');
      router.push('/dashboard');
    }
  }, [phase, status.data?.applied, router]);

  const handleApply = React.useCallback(async () => {
    setErrorMessage(null);
    setPhase('applying');
    try {
      await apply.mutateAsync({});
      setPhase('polling');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [apply]);

  const isBusy = phase === 'applying' || phase === 'polling';

  return (
    <div className="space-y-3" data-testid="demo-loader">
      <Button
        type="button"
        onClick={handleApply}
        disabled={isBusy}
        className="w-full"
        data-testid="demo-loader-apply"
      >
        {isBusy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {phase === 'applying' ? 'Applying demo…' : 'Waiting for apply to land…'}
          </>
        ) : (
          'Load Demo'
        )}
      </Button>

      {phase === 'error' && errorMessage ? (
        <p
          className="text-xs text-destructive"
          role="alert"
          data-testid="demo-loader-error"
        >
          Failed to load demo: {errorMessage}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Applies the {DEMO_SEED} seed in your current environment. Idempotent —
        safe to re-run.
      </p>
    </div>
  );
}