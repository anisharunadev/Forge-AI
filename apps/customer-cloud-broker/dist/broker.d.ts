/**
 * The broker core. Every brokered action flows through `brokerAction`.
 *
 * Pipeline (matches ADR-0003 §6.2):
 *   1. Validate envelope (already done by the Fastify handler — the
 *      broker assumes `request` is a typed `BrokeredRequest`).
 *   2. Look up tenant trust for the requested cloud. Refuse if
 *      missing or `cloud_disabled`.
 *   3. Deny-list check. Refuse if the action matches. The federation
 *      token is *never* minted on a deny-list hit.
 *   4. Adapter lookup. Refuse if no adapter is registered (e.g.
 *      Azure before FORA-126.2 lands).
 *   5. Adapter `assume()` with the FORA-issued JWT.
 *   6. Adapter `perform()` with the assumed credential.
 *   7. Emit exactly one `cloud.brokered` audit event with the
 *      `BrokeredResult`. The audit payload contains *no* credential
 *      material by construction (see `audit.ts`).
 *   8. Update metrics.
 *   9. Return the `BrokeredResult` to the caller.
 *
 * On any failure path, the broker emits a single audit event with the
 * failure code and returns the same shape so the agent always sees a
 * well-typed result.
 */
import type { BrokeredRequest, BrokeredResult } from './types.js';
import type { DenyListMatcher } from './deny-list.js';
import { type AuditSink } from './audit.js';
import type { BrokerMetrics } from './metrics.js';
import type { TrustStore } from './trust.js';
import type { AdapterRegistry } from './adapters/index.js';
export interface BrokerDeps {
    audit: AuditSink;
    metrics: BrokerMetrics;
    trust_store: TrustStore;
    deny_list: DenyListMatcher;
    adapters: AdapterRegistry;
    /** Mint the FORA-issued token that the broker exchanges at the cloud. Injected for tests. */
    mint_fora_jwt: (request: BrokeredRequest) => Promise<string>;
    /** Override the actor string written to the audit event. */
    actor_for?: (request: BrokeredRequest) => string;
    /** `now()` override for tests. */
    now?: () => number;
}
export declare function brokerAction(request: BrokeredRequest, deps: BrokerDeps): Promise<BrokeredResult>;
