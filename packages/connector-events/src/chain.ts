/**
 * Per-(tenant, binding) hash chain — FORA-484 AC #5.
 *
 * The connector event chain is distinct from the audit-spine chain
 * (`agents/audit/chain.py`), which is per-(tenant, run). Connector
 * chains are per-(tenant, binding) — every credential binding gets
 * its own append-only chain, so a binding rotation cleanly terminates
 * one chain and starts another.
 *
 *   event_hash = SHA-256(canonical_json(event w/o audit_chain.event_hash)
 *                         || ":" || prev_event_hash)
 *
 * The chain head is the (tenant_id, binding_id) pair. A break is
 * reported as a `ChainBreak` record so the verifier can return every
 * problem in one pass, not just the first.
 */

import { createHash } from 'node:crypto';
import type { AuditChain, ConnectorEvent } from './envelope.js';

/** 32 zero bytes, hex-encoded. The `prev_event_hash` of the first event. */
export const GENESIS_HASH = '0'.repeat(64);

/** Sentinel returned by `nextHash` when the canonical form cannot be computed. */
export class ChainIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainIntegrityError';
  }
}

/**
 * Canonical JSON for hashing. Recursively sorts object keys so the
 * output is stable regardless of insertion order. `undefined` is
 * omitted (mirrors the Python `canonical_json` precedent). NaN/Inf
 * throw via `JSON.stringify`'s default behaviour.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = sortKeysDeep(v);
  return out;
}

/** Hex SHA-256 of any JSON-serialisable payload. Stable across processes. */
export function digestOf(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/**
 * Compute the record hash for `event` chained to `prevHash`.
 *
 * The input is `canonical_json(stableEvent) || ":" || prevHash`.
 * `stableEvent` is the event with `audit_chain.event_hash` removed
 * (the field being computed).
 */
export function nextHash(event: ConnectorEvent, prevHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(prevHash)) {
    throw new ChainIntegrityError(`prevHash must be a 64-char hex digest: ${prevHash}`);
  }
  const stable = stripEventHash(event);
  const input = `${canonicalJson(stable)}:${prevHash}`;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Return the event with `audit_chain.event_hash` removed (kept immutable). */
export function stripEventHash(event: ConnectorEvent): Omit<ConnectorEvent, 'audit_chain'> & {
  audit_chain: Omit<AuditChain, 'event_hash'>;
} {
  const { audit_chain, ...rest } = event;
  const { event_hash: _eh, ...chain } = audit_chain;
  return { ...rest, audit_chain: chain };
}

export interface ChainBreak {
  index: number;
  event_id: string;
  expected_prev_hash: string;
  actual_prev_hash: string;
  reason: 'prev_hash_mismatch' | 'self_hash_mismatch';
}

/** Walk `events` and verify the chain. Returns (ok, breaks). */
export function verifyChain(events: ConnectorEvent[]): {
  ok: boolean;
  breaks: ChainBreak[];
} {
  const breaks: ChainBreak[] = [];
  let prev = GENESIS_HASH;
  for (let idx = 0; idx < events.length; idx += 1) {
    const ev = events[idx]!;
    if (ev.audit_chain.prev_event_hash !== prev) {
      breaks.push({
        index: idx,
        event_id: ev.event_id,
        expected_prev_hash: prev,
        actual_prev_hash: ev.audit_chain.prev_event_hash,
        reason: 'prev_hash_mismatch',
      });
      // Don't trust any subsequent hashes from this point.
      continue;
    }
    const expected = nextHash(ev, ev.audit_chain.prev_event_hash);
    if (ev.audit_chain.event_hash !== expected) {
      breaks.push({
        index: idx,
        event_id: ev.event_id,
        expected_prev_hash: prev,
        actual_prev_hash: ev.audit_chain.prev_event_hash,
        reason: 'self_hash_mismatch',
      });
      continue;
    }
    prev = ev.audit_chain.event_hash;
  }
  return { ok: breaks.length === 0, breaks };
}

/** Generate a stable event id: `evt-<uuid16>`. */
export function makeEventId(): string {
  // crypto.randomUUID gives 32 hex chars; we keep the 16-char convention.
  const hex = createHash('sha256')
    .update(`${Date.now()}:${Math.random()}:${process.pid}`)
    .digest('hex')
    .slice(0, 32);
  return `evt-${hex}`;
}