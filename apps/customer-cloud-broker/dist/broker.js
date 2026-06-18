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
import { CLOUDS, MAX_CREDENTIAL_LIFETIME_MS } from './types.js';
import { cloudBrokeredEvent } from './audit.js';
export async function brokerAction(request, deps) {
    const start = (deps.now ?? Date.now)();
    const actor = deps.actor_for?.(request) ?? `${request.agent_type}:${request.trace_id}`;
    // Stage 1: pick the cloud from the action args. The action itself is
    // not enough — the args carry the cloud discriminator.
    const cloud = request.args.cloud;
    if (!CLOUDS.includes(cloud)) {
        return reject(request, actor, cloud, 'unsupported_cloud', 'cloud arg missing or invalid', start, deps);
    }
    // Stage 2: tenant trust lookup.
    const trust = deps.trust_store.get(request.tenant_id, cloud);
    if (!trust || trust.trust_state !== 'active') {
        return reject(request, actor, cloud, 'cloud_disabled', trust?.disabled_reason ?? `no trust record for tenant ${request.tenant_id}`, start, deps);
    }
    // Stage 3: deny-list.
    const denyHit = deps.deny_list.match(cloud, request.action);
    if (denyHit) {
        return reject(request, actor, cloud, 'deny_listed_action', `deny-list hit: ${denyHit.action}`, start, deps);
    }
    // Stage 4: adapter lookup.
    const adapter = deps.adapters.get(cloud);
    if (!adapter) {
        return reject(request, actor, cloud, 'unsupported_cloud', `no adapter registered for cloud ${cloud}`, start, deps);
    }
    // Stage 5: assume.
    let assume;
    try {
        const for_jwt = await deps.mint_fora_jwt(request);
        assume = await adapter.assume(request.args, for_jwt);
    }
    catch (err) {
        return reject(request, actor, cloud, 'assume_failed', errorMessage(err), start, deps);
    }
    if (assume.expires_at_ms - start > MAX_CREDENTIAL_LIFETIME_MS) {
        return reject(request, actor, cloud, 'credential_too_long', `assumed credential would exceed ${MAX_CREDENTIAL_LIFETIME_MS}ms cap`, start, deps);
    }
    // Stage 6: perform.
    let response;
    try {
        response = await adapter.perform(assume.handle, request.args, {
            tenant_id: request.tenant_id,
            trace_id: request.trace_id,
        });
    }
    catch (err) {
        return reject(request, actor, cloud, 'operation_failed', errorMessage(err), start, deps);
    }
    // Stage 7-9: success path.
    const result = {
        trace_id: request.trace_id,
        tenant_id: request.tenant_id,
        cloud,
        account: trust.account,
        action: request.action,
        response_code: 'ok',
        response,
        duration_ms: (deps.now ?? Date.now)() - start,
        role_fingerprint: assume.role_fingerprint,
    };
    await deps.audit.write(cloudBrokeredEvent({ result, actor, metadata: { tenant_account: trust.account } }));
    deps.metrics.incAssume(cloud);
    deps.metrics.observeDuration(cloud, result.duration_ms);
    return result;
}
// ---------------------------------------------------------------------------
// Reject path. Every failure mode returns a fully-typed BrokeredResult
// and emits exactly one audit event with the failure response_code.
// ---------------------------------------------------------------------------
async function reject(request, actor, cloud, code, reason, start, deps) {
    const trustAccount = cloud !== 'unknown' ? deps.trust_store.get(request.tenant_id, cloud)?.account ?? 'unknown' : 'unknown';
    const actionCloud = CLOUDS.includes(cloud)
        ? cloud
        : 'aws';
    const result = {
        trace_id: request.trace_id,
        tenant_id: request.tenant_id,
        cloud: actionCloud,
        account: trustAccount,
        action: request.action,
        response_code: code,
        response: { reason },
        duration_ms: (deps.now ?? Date.now)() - start,
        role_fingerprint: 'none',
    };
    await deps.audit.write(cloudBrokeredEvent({ result, actor, metadata: { reject_reason: reason } }));
    if (CLOUDS.includes(actionCloud)) {
        deps.metrics.incOutcome(actionCloud, code);
        deps.metrics.observeDuration(actionCloud, result.duration_ms);
    }
    return result;
}
function errorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
