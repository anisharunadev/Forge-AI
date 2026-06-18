import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness endpoint for `scripts/smoke.sh`. We don't depend on the
 * orchestrator here — that is `scripts/smoke.sh`'s separate probe —
 * because the Forge console must stay reachable even when the
 * orchestrator is down (e.g. during local recovery). A 200 here just
 * proves Next.js is alive.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'forge' });
}