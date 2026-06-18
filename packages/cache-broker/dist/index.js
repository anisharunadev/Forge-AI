/**
 * @fora/cache-broker — public API
 *
 * The only surface the rest of the platform imports. Re-exports the broker,
 * the typed contexts and errors, the audit event shape and sinks, and the
 * key derivation helpers. See FORA-165 + ADR-0003 §4.1 (cache row in the
 * tenancy matrix).
 */
export { deriveKey, deriveTag, keyMaterial } from './keys.js';
export { TenantMismatchError } from './types.js';
export { CacheBroker } from './broker.js';
export { InMemoryCacheStore } from './store.js';
export { InMemoryAuditSink, JsonlAuditSink, NullAuditSink, defaultAuditSink, } from './audit.js';
//# sourceMappingURL=index.js.map