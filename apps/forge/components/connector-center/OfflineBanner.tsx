'use client';

/**
 * OfflineBanner — M3-G14.
 *
 * Surfaces a destructive-variant Alert at the top of the Connector
 * Center tab strip whenever the backend is unreachable. The banner is
 * driven by the 4 React Query states:
 *
 *   - `live === true` (the provider is in "use backend" mode) AND
 *   - any of the 4 backing queries (`useConnectors`, `useMarketplace`,
 *     `useCredentials`, `useConnectorActivity`) reports `isError`.
 *
 * The banner is suppressed when the provider is in offline/mock mode
 * (`live === false`) so storybook and tests don't render it. The
 * `data-testid` is rendered as soon as the error condition becomes
 * true so Playwright can assert on it.
 *
 * Render order: the banner is rendered as a sibling of the tab strip,
 * not nested inside the tab bar, so the destructive variant's red
 * border sits above the page chrome without shifting the tab
 * geometry. The `mb-3` margin matches the existing vertical rhythm
 * of the page so the rest of the page doesn't reflow.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useConnectors,
  useMarketplace,
  useCredentials,
  useConnectorActivity,
} from '@/lib/hooks/useConnectors';
import { useLiveConnectorData } from './LiveConnectorDataProvider';

export interface OfflineBannerProps {
  /**
   * When provided, the banner reads these flags instead of the live
   * hooks. Useful for unit tests + storybook. Default: read the four
   * hooks directly so production callers don't have to thread props.
   */
  readonly isOffline?: boolean;
}

export function OfflineBanner({ isOffline }: OfflineBannerProps = {}) {
  // The provider's `live` flag tells us whether the user wants the
  // banner to even be possible. When the page is in mock-only mode
  // (storybook / storyshots) we suppress the banner entirely so the
  // destructive variant doesn't make the docs look broken.
  const ctx = useLiveConnectorData();
  const live = ctx?.live ?? false;
  if (!live) return null;

  // Compute the error flag — prefer the explicit prop, otherwise
  // fall through to the live hooks.
  const liveConnectors = useConnectors();
  const liveMarketplace = useMarketplace();
  const liveCredentials = useCredentials();
  const liveActivity = useConnectorActivity();

  const hasError =
    isOffline ??
    (liveConnectors.isError ||
      liveMarketplace.isError ||
      liveCredentials.isError ||
      liveActivity.isError);

  if (!hasError) return null;

  return (
    <Alert
      variant="destructive"
      className="mb-3"
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Showing offline data — backend unreachable</AlertTitle>
      <AlertDescription>
        The Forge API is unreachable. The Connector Center is rendering the
        in-memory fallback dataset so you can keep working. Writes (install,
        rotate, test, disconnect) are queued locally and will retry when the
        backend recovers.
      </AlertDescription>
    </Alert>
  );
}