import { NextRequest, NextResponse } from 'next/server';
import { isPersona, personaCookie } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/persona — set the persona cookie. The single-tenant auth
 * stub (FORA-374 §6) does not authenticate the caller; FORA-123 owns
 * production auth and will replace this route when it lands.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'invalid json body' }, { status: 400 });
  }
  const persona =
    typeof body === 'object' && body !== null && 'persona' in body
      ? (body as { persona: unknown }).persona
      : null;
  if (!isPersona(persona)) {
    return NextResponse.json(
      { message: 'persona must be one of pm, eng-lead, cto' },
      { status: 400 },
    );
  }
  const res = NextResponse.json({ persona });
  res.headers.set('set-cookie', personaCookie(persona));
  return res;
}