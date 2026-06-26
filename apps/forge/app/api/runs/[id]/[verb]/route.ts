import { NextRequest, NextResponse } from 'next/server';
import { runLifecycle } from '@/lib/api';
import type { LifecycleVerb } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VERBS: ReadonlyArray<LifecycleVerb> = ['pause', 'resume', 'cancel'];

function isVerb(value: string): value is LifecycleVerb {
  return (VERBS as ReadonlyArray<string>).includes(value);
}

/**
 * Proxy the lifecycle POSTs from the operator action bar through a
 * Next route handler so the browser gets same-origin JSON (and the
 * persona cookie is sent automatically). The orchestrator requires
 * `Idempotency-Key`; `lib/api.ts` mints one per call.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; verb: string }> },
) {
  const { id, verb } = await params;
  if (!isVerb(verb)) {
    return NextResponse.json(
      { message: `unknown verb ${verb}` },
      { status: 400 },
    );
  }
  try {
    const run = await runLifecycle(id, verb);
    return NextResponse.json(run);
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status: unknown }).status)
        : 502;
    const message = err instanceof Error ? err.message : 'orchestrator error';
    return NextResponse.json({ message }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}