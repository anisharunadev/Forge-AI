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
/** Validate a tenant_id segment. Allowed: alphanumerics, underscores, dashes; 1..64 chars. */
export declare function isValidTenantId(tenantId: string): boolean;
/** Validate an event_type segment. snake_case, 1..64 chars. */
export declare function isValidEventType(eventType: string): boolean;
/** Build the canonical subject for an event. */
export declare function buildSubject(params: {
    tenantId: string;
    eventType: string;
    major: number;
}): string;
/** Parse a subject into its parts. Returns null on malformed input. */
export declare function parseSubject(subject: string): {
    tenantId: string;
    eventType: string;
    major: number;
} | null;
/**
 * The producer's tenant guard: refuse to publish to a subject whose tenant
 * segment does not match the producer's tenant identity.
 *
 * Use this on every publish, before the broker sees the call.
 */
export declare function assertSubjectTenant(subject: string, producerTenantId: string): void;
/** The consumer-side tenant ACL. A consumer for tenant A can only subscribe to subjects matching this prefix. */
export declare function tenantSubjectPrefix(tenantId: string): string;
