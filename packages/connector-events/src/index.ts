/**
 * @fora/connector-events — FORA-484.
 *
 * Public surface: universal connector audit envelope, hash-chained
 * per-(tenant, binding) store, RBAC-gated typed-artifact rule engine,
 * and the five Tier-1 family event catalogs plus the cross-connector
 * lifecycle event helpers.
 */

export * from './envelope.js';
export * from './chain.js';
export * from './store.js';
export * from './emit.js';
export * from './registry.js';
export * as lifecycle from './lifecycle.js';
export * as families from './families/index.js';