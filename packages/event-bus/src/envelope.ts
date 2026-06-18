/**
 * Event envelope — the wire-format wrapper around every event published to the bus.
 *
 * Per ADR-0006 §3.2 the envelope is the same shape regardless of event_type:
 *
 *   {
 *     "v": "1.0.0",
 *     "event_id": "evt-<uuid>",
 *     "run_id": "<uuid>",
 *     "tenant_id": "tnt_8XQ…",
 *     "stage": "dev" | null,
 *     "event_type": "stage_completed",
 *     "occurred_at": "2026-06-17T12:34:56.789Z",
 *     "actor": { "type": "agent", "id": "agent:developer" },
 *     "payload": { /* event-specific *\/ }
 *   }
 *
 * Consumers dedupe on `event_id`. The bus guarantees at-least-once delivery;
 * the dedupe contract is the consumer's responsibility.
 */

import { z } from 'zod';

/** Semver-shaped schema version. The major component is the wire-format contract. */
export const SchemaVersionSchema = z
  .string()
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/, 'must be semver (e.g. 1.0.0)');

/** The seven stage names. Mirrors FORA-50 spec §2.3 + §3.1. */
export const StageSchema = z.enum([
  'ideation',
  'architect',
  'dev',
  'qa',
  'security',
  'devops',
  'docs',
]);

/** "done" is a terminal run status, not a stage; the envelope carries it as null when N/A. */
export const ActorSchema = z.object({
  type: z.enum(['agent', 'user', 'system']),
  id: z.string().min(1),
});

/** Generic envelope — payload is typed at the per-event schema layer (see events/). */
export const EventEnvelopeSchema = z.object({
  v: SchemaVersionSchema,
  event_id: z.string().min(1),
  run_id: z.string().min(1),
  tenant_id: z.string().min(1),
  stage: StageSchema.nullable(),
  event_type: z.string().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  actor: ActorSchema,
  payload: z.unknown(),
});

export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type EventEnvelope<TPayload = unknown> = {
  v: SchemaVersion;
  event_id: string;
  run_id: string;
  tenant_id: string;
  stage: Stage | null;
  event_type: string;
  occurred_at: string;
  actor: Actor;
  payload: TPayload;
};

/** Parsed major/minor/patch from a SemVer string. */
export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a semver into parts. Throws on malformed input. */
export function parseSemver(v: string): ParsedSemver {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(v);
  if (!match) throw new Error(`not a semver: ${v}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { major, minor, patch };
}

/** True iff the consumer's `maxMajor` is >= the producer event's major. */
export function isVersionSupported(eventVersion: string, consumerMaxMajor: number): boolean {
  return parseSemver(eventVersion).major <= consumerMaxMajor;
}
