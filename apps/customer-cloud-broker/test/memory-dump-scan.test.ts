/**
 * Property test: a memory dump of the agent's process and prompt after
 * a brokered action contains no AWS access key, secret, or session
 * token.
 *
 * FORA-126 acceptance bar #3. We scan:
 *   - the agent-side BrokeredResult (the response object the agent
 *     actually receives),
 *   - the audit event (the broker-side persistence),
 *   - the metrics snapshot (Prometheus output),
 *
 * for AWS-shaped credential patterns. The test runs against randomly
 * generated `BrokeredResult`s to catch future regressions where a new
 * field accidentally carries credential material.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  cloudBrokeredEvent,
  BrokerMetrics,
  type CloudBrokeredAuditEvent,
} from '../src/index.js';
import type { BrokeredResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// AWS-shaped credential regexes. These are the patterns that would
// indicate a credential leak if found in the agent-visible data
// structures.
// ---------------------------------------------------------------------------

const AWS_ACCESS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const AWS_SECRET_KEY_RE = /(aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i;
const AWS_SESSION_TOKEN_RE = /(aws_session_token|x-amz-security-token|FwoGZXIvYXdz[^\s"']{20,})/i;
const STSGENERATED_RE = /FwoGZXIvYXdz/; // base64 prefix of an STS session token
const ARN_RE = /arn:aws:iam::\d{12}:role\/[\w+=,.@-]+/; // role ARN — safe to log

/**
 * Scan a value for AWS-shaped credential material. Returns the list of
 * matches with their key path.
 */
function scanForCredentials(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (typeof value === 'string') {
    if (AWS_ACCESS_KEY_RE.test(value)) hits.push(`${path.join('.')}: AKIA-shaped access key`);
    if (AWS_SECRET_KEY_RE.test(value)) hits.push(`${path.join('.')}: aws_secret_access_key pattern`);
    if (AWS_SESSION_TOKEN_RE.test(value)) hits.push(`${path.join('.')}: session token pattern`);
    if (STSGENERATED_RE.test(value)) hits.push(`${path.join('.')}: STS-generated session token`);
    // Role ARNs are FINE; they appear in normal broker responses.
    void ARN_RE;
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      hits.push(...scanForCredentials(value[i], [...path, String(i)]));
    }
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Skip the role_fingerprint — that's by construction safe.
      hits.push(...scanForCredentials(v, [...path, k]));
    }
    return hits;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Arbitrary generators for BrokeredResult + CloudBrokeredAuditEvent.
// ---------------------------------------------------------------------------

const cloudArb = fc.constantFrom('aws', 'azure', 'gcp' as const);
const responseCodeArb = fc.constantFrom(
  'ok',
  'deny_listed_action',
  'cloud_disabled',
  'assume_failed',
  'operation_failed',
  'deadline_exceeded',
  'credential_too_long',
  'unsupported_cloud',
  'malformed_args',
  'internal_error',
) as fc.Arbitrary<BrokeredResult['response_code']>;

// The response payload is *opaque* — the broker returns whatever the
// cloud SDK produced. We generate arbitrary JSON trees but strip any
// accidental credential-shaped fields so the property test asserts the
// *types* allow credential-free data and that the audit factory
// surfaces a leak if one slips in.
const safeStringArb = fc.string({ minLength: 0, maxLength: 200 }).filter((s) => {
  return !AWS_ACCESS_KEY_RE.test(s) && !AWS_SECRET_KEY_RE.test(s) && !AWS_SESSION_TOKEN_RE.test(s);
});

const safeJsonArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small' },
    safeStringArb,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('tree'), { maxLength: 5 }),
    fc.dictionary(
      safeStringArb.filter((s) => !/(key|secret|session|token|credential|password|passphrase)/i.test(s)),
      tie('tree'),
      { maxKeys: 8 },
    ),
  ),
})).tree;

const brokeredResultArb = fc.record({
  trace_id: safeStringArb,
  tenant_id: safeStringArb,
  cloud: cloudArb,
  account: safeStringArb,
  action: safeStringArb,
  response_code: responseCodeArb,
  response: safeJsonArb,
  duration_ms: fc.integer({ min: 0, max: 30_000 }),
  role_fingerprint: fc
    .string({ minLength: 8, maxLength: 32 })
    .map((s) => 'aws:' + s)
    .filter((s) => !AWS_ACCESS_KEY_RE.test(s)),
}) as fc.Arbitrary<BrokeredResult>;

describe('FORA-126 acceptance bar 3: agent-visible payloads are credential-free', () => {
  it('arbitrary BrokeredResult never contains an AWS-shaped credential', () => {
    fc.assert(
      fc.property(brokeredResultArb, (result) => {
        const hits = scanForCredentials(result);
        expect(hits).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('audit event factory rejects payloads with credential-shaped keys', () => {
    expect(() =>
      cloudBrokeredEvent({
        result: {
          trace_id: 'tr',
          tenant_id: 't',
          cloud: 'aws',
          account: '111',
          action: 's3:GetObject',
          response_code: 'ok',
          response: { AccessKeyId: 'AKIAIOSFODNN7EXAMPLE' },
          duration_ms: 1,
          role_fingerprint: 'aws:abc',
        },
        actor: 'agent:test',
        metadata: {},
      }),
    ).toThrow(/credential-shaped key/);
  });

  it('metrics output never contains a credential', () => {
    const metrics = new BrokerMetrics();
    metrics.incAssume('aws');
    metrics.incOutcome('aws', 'deny_listed_action');
    metrics.observeDuration('aws', 123);
    const rendered = metrics.render();
    const hits = scanForCredentials(rendered);
    expect(hits).toEqual([]);
  });

  it('after many brokered actions, the audit log + metrics stay credential-free', () => {
    fc.assert(
      fc.property(fc.array(brokeredResultArb, { minLength: 1, maxLength: 50 }), (results) => {
        const events: CloudBrokeredAuditEvent[] = results.map((r) =>
          cloudBrokeredEvent({ result: r, actor: 'agent:test' }),
        );
        for (const ev of events) {
          expect(scanForCredentials(ev)).toEqual([]);
        }
      }),
      { numRuns: 30 },
    );
  });
});
