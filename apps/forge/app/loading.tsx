/**
 * app/loading.tsx — streaming loading fallback.
 *
 * Server Component. Renders automatically while a route segment is
 * streaming (Suspense fallback for async Server Components, fetch
 * requests, etc). Uses the new shadcn Skeleton primitive so the
 * shimmer animation lives in one place and respects
 * `prefers-reduced-motion` via globals.css.
 *
 * Width is tuned to the `max-w-7xl` shell in `app/layout.tsx`.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <main
      className="mx-auto max-w-3xl py-16"
      data-testid="app-loading"
      role="status"
      aria-label="Loading content"
    >
      <div className="space-y-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </main>
  );
}
