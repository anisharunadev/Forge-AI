/**
 * Subject construction and tenant-isolation guard.
 *
 * Per ADR-0006 §3.1: `fora.events.<tenant_id>.<event_type>.v<major>`.
 * Tenant isolation is enforced at the subject layer; the broker is configured
 * to allow tenant A consumers only subjects matching `fora.events.<tenant_a>.>`.
 *
 * The producer is single-tenant — every publish carries the producer's tenant_id,
 * and the subject builder refuses to emit a subject whose tenant segment
 * does not match. This is the in-process gate; the broker ACL is the cloud-side gate.
 */
import { InvalidInputError, TenantMismatchError } from './errors.js';
/** Validate a tenant_id segment. Allowed: alphanumerics, underscores, dashes; 1..64 chars. */
export function isValidTenantId(tenantId) {
    return /^[a-zA-Z0-9_-]{1,64}$/.test(tenantId);
}
/** Validate an event_type segment. snake_case, 1..64 chars. */
export function isValidEventType(eventType) {
    return /^[a-z][a-z0-9_]{0,63}$/.test(eventType);
}
/** Build the canonical subject for an event. */
export function buildSubject(params) {
    const { tenantId, eventType, major } = params;
    if (!isValidTenantId(tenantId)) {
        throw new InvalidInputError(`invalid tenant_id "${tenantId}"`);
    }
    if (!isValidEventType(eventType)) {
        throw new InvalidInputError(`invalid event_type "${eventType}"`);
    }
    if (!Number.isInteger(major) || major < 1 || major > 1000) {
        throw new InvalidInputError(`invalid major version ${major}`);
    }
    return `fora.events.${tenantId}.${eventType}.v${major}`;
}
/** Parse a subject into its parts. Returns null on malformed input. */
export function parseSubject(subject) {
    const match = /^fora\.events\.([a-zA-Z0-9_-]{1,64})\.([a-z][a-z0-9_]{0,63})\.v([0-9]+)$/.exec(subject);
    if (!match)
        return null;
    return {
        tenantId: match[1],
        eventType: match[2],
        major: Number(match[3]),
    };
}
/**
 * The producer's tenant guard: refuse to publish to a subject whose tenant
 * segment does not match the producer's tenant identity.
 *
 * Use this on every publish, before the broker sees the call.
 */
export function assertSubjectTenant(subject, producerTenantId) {
    const parsed = parseSubject(subject);
    if (!parsed) {
        throw new InvalidInputError(`not a FORA subject: "${subject}"`);
    }
    if (parsed.tenantId !== producerTenantId) {
        throw new TenantMismatchError(producerTenantId, parsed.tenantId, subject);
    }
}
/** The consumer-side tenant ACL. A consumer for tenant A can only subscribe to subjects matching this prefix. */
export function tenantSubjectPrefix(tenantId) {
    if (!isValidTenantId(tenantId)) {
        throw new InvalidInputError(`invalid tenant_id "${tenantId}"`);
    }
    return `fora.events.${tenantId}.>`;
}
//# sourceMappingURL=subject.js.map