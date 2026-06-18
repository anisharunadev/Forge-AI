/**
 * Broker for the secrets-mcp.
 *
 * The broker is the seam between the MCP tool surface (which an
 * agent can call) and the backing store (which holds raw values).
 * Two responsibilities:
 *
 *   1. Resolve a `secret_ref` and return a *redacted* envelope.
 *      The raw value is never returned to the agent; the envelope
 *      is the contract.
 *   2. Audit every resolve / rotate / access-denied call. The audit
 *      event carries the `secret_ref` and the `fingerprint`; it
 *      NEVER carries the raw value.
 *
 * The audit emit is a sink interface — the production sink is the
 * FORA-36 Postgres store (per ADR-0003 §8.1), the test sink is an
 * in-memory array. The seam is here, not in the store, because
 * audit is a property of the *resolution* (the boundary the agent
 * crosses), not of the storage.
 */

import type { RedactedSecret, SecretRef } from "./secret_ref.js";
import { parseSecretRef, redact, formatSecretRef } from "./secret_ref.js";
import type { SecretStore } from "./store.js";
import { SecretNotFoundError, TenantScopeError } from "./store.js";
import {
  BrokeredActionRegistry,
  type BrokeredActionResult,
  type BrokeredIntent,
  InvalidPayloadError,
  UnknownIntentError,
} from "./brokered.js";

/** Audit event shape. Mirrors `AuthAuditEvent` in
 *  `apps/identity-broker/src/audit.ts`; the field set is the
 *  minimum the audit sink needs to satisfy ADR-0003 §8.1. */
export interface SecretAuditEvent {
  action:
    | "secret.resolved"
    | "secret.rotated"
    | "secret.access_denied"
    | `secret.used_for_${string}`;
  tenant_id: string;
  /** The agent's principal, propagated from the broker's claim. */
  actor: string;
  /** The `agent_type` from the ToolCall — e.g. "developer",
   *  "security-engineer", "deploy-agent". */
  agent_type: string;
  secret_ref: string;
  fingerprint?: string;
  value_len?: number;
  decision: "allow" | "deny";
  trace_id: string;
  timestamp: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditSink {
  emit(event: SecretAuditEvent): void;
}

/** In-memory audit sink used by the smoke test. Production replaces
 *  this with a forwarder to the FORA-36 Postgres audit store. */
export class InMemoryAuditSink implements AuditSink {
  public readonly events: SecretAuditEvent[] = [];
  emit(event: SecretAuditEvent): void {
    this.events.push(event);
  }
}

export interface ResolveOk {
  ok: true;
  envelope: RedactedSecret;
}

export interface ResolveErr {
  ok: false;
  code: "tenant_scope" | "not_found" | "invalid_ref" | "store_error";
  message: string;
}

export interface UseForErr {
  ok: false;
  code: "tenant_scope" | "not_found" | "invalid_ref" | "store_error" | "unknown_intent" | "invalid_payload";
  message: string;
}

export interface UseForOk {
  ok: true;
  /** The action result envelope from the registered handler. The
   *  raw value is NEVER in this envelope. */
  result: BrokeredActionResult;
}

export class SecretsBroker {
  constructor(
    private readonly store: SecretStore,
    private readonly audit: AuditSink,
    private readonly tenantId: string,
    private readonly traceId: string,
    private readonly actor: string,
    private readonly agentType: string,
    private readonly brokered: BrokeredActionRegistry = new BrokeredActionRegistry(),
  ) {}

  async resolve(refInput: string): Promise<ResolveOk | ResolveErr> {
    let ref: SecretRef;
    try {
      ref = parseSecretRef(refInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: refInput,
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "invalid_ref",
        metadata: { error: message },
      });
      return { ok: false, code: "invalid_ref", message };
    }

    try {
      const version = await this.store.read(ref, this.tenantId);
      // The envelope's `version` field is the *actual* version id
      // returned by the store, not the requested `ref.version`. A
      // request for `@latest` returns the resolved integer; the
      // caller can see what they got.
      const resolvedRef: SecretRef = { ...ref, version: version.version };
      const envelope = redact(resolvedRef, version.value, version.expires_at);
      this.audit.emit({
        action: "secret.resolved",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        fingerprint: envelope.fingerprint,
        value_len: envelope.value_len,
        decision: "allow",
        trace_id: this.traceId,
        timestamp: envelope.resolved_at,
        metadata: { version: envelope.version },
      });
      return { ok: true, envelope };
    } catch (err) {
      if (err instanceof TenantScopeError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "tenant_scope",
          metadata: { error: err.message },
        });
        return { ok: false, code: "tenant_scope", message: err.message };
      }
      if (err instanceof SecretNotFoundError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "not_found",
          metadata: { error: err.message },
        });
        return { ok: false, code: "not_found", message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "store_error",
        metadata: { error: message },
      });
      return { ok: false, code: "store_error", message };
    }
  }

  async rotate(refInput: string, newValue: string): Promise<
    | { ok: true; secret_ref: string; version: string; created_at: string }
    | ResolveErr
  > {
    let ref: SecretRef;
    try {
      ref = parseSecretRef(refInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: refInput,
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "invalid_ref",
        metadata: { error: message, op: "rotate" },
      });
      return { ok: false, code: "invalid_ref", message };
    }

    try {
      const out = await this.store.rotate(ref, this.tenantId, newValue);
      this.audit.emit({
        action: "secret.rotated",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        decision: "allow",
        trace_id: this.traceId,
        timestamp: out.created_at,
        metadata: { version: out.version },
      });
      return {
        ok: true,
        secret_ref: formatSecretRef(ref),
        version: out.version,
        created_at: out.created_at,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "store_error",
        metadata: { error: message, op: "rotate" },
      });
      return { ok: false, code: "store_error", message };
    }
  }

  /**
   * Broker-side raw-use pattern (FORA-128.f).
   *
   * 1. Parse + validate the secret_ref (reject cross-tenant).
   * 2. Resolve the value at the store.
   * 3. Look up the handler for `intent` in the registry, call it
   *    with `(value, payload)` in-process.
   * 4. Emit `secret.used_for_<intent>` with secret_ref + fingerprint.
   * 5. Return the handler's result envelope. The raw value is dropped
   *    at this point — the handler is the only thing that sees it.
   *
   * `intent` is a string at the boundary (the MCP tool accepts an
   * arbitrary string). The registry validates and returns
   * `unknown_intent` if no handler is registered.
   */
  async useFor(
    refInput: string,
    intent: string,
    payload: unknown,
  ): Promise<UseForOk | UseForErr> {
    let ref: SecretRef;
    try {
      ref = parseSecretRef(refInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: refInput,
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "invalid_ref",
        metadata: { error: message, op: `use_for:${intent}` },
      });
      return { ok: false, code: "invalid_ref", message };
    }

    let value: string;
    let value_len: number;
    let fingerprint: string;
    try {
      const version = await this.store.read(ref, this.tenantId);
      value = version.value;
      value_len = Buffer.byteLength(value, "utf8");
      const { fingerprint: fp } = await import("./secret_ref.js");
      fingerprint = fp(value);
    } catch (err) {
      if (err instanceof TenantScopeError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "tenant_scope",
          metadata: { error: err.message, op: `use_for:${intent}` },
        });
        return { ok: false, code: "tenant_scope", message: err.message };
      }
      if (err instanceof SecretNotFoundError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "not_found",
          metadata: { error: err.message, op: `use_for:${intent}` },
        });
        return { ok: false, code: "not_found", message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "store_error",
        metadata: { error: message, op: `use_for:${intent}` },
      });
      return { ok: false, code: "store_error", message };
    }

    // The value crosses the broker→handler boundary in-process.
    // The handler is responsible for not echoing it; the broker
    // discards it on the way back.
    let result: BrokeredActionResult;
    try {
      result = await this.brokered.invoke(intent, value, payload);
    } catch (err) {
      if (err instanceof UnknownIntentError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "store_error",
          metadata: {
            error: err.message,
            op: `use_for:${intent}`,
            reason_detail: "unknown_intent",
          },
        });
        return { ok: false, code: "unknown_intent", message: err.message };
      }
      if (err instanceof InvalidPayloadError) {
        this.audit.emit({
          action: "secret.access_denied",
          tenant_id: this.tenantId,
          actor: this.actor,
          agent_type: this.agentType,
          secret_ref: formatSecretRef(ref),
          decision: "deny",
          trace_id: this.traceId,
          timestamp: new Date().toISOString(),
          reason: "store_error",
          metadata: {
            error: err.message,
            op: `use_for:${intent}`,
            reason_detail: "invalid_payload",
          },
        });
        return { ok: false, code: "invalid_payload", message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.audit.emit({
        action: "secret.access_denied",
        tenant_id: this.tenantId,
        actor: this.actor,
        agent_type: this.agentType,
        secret_ref: formatSecretRef(ref),
        decision: "deny",
        trace_id: this.traceId,
        timestamp: new Date().toISOString(),
        reason: "store_error",
        metadata: { error: message, op: `use_for:${intent}` },
      });
      return { ok: false, code: "store_error", message };
    }

    this.audit.emit({
      action: `secret.used_for_${intent}` as SecretAuditEvent["action"],
      tenant_id: this.tenantId,
      actor: this.actor,
      agent_type: this.agentType,
      secret_ref: formatSecretRef(ref),
      fingerprint,
      value_len,
      decision: "allow",
      trace_id: this.traceId,
      timestamp: new Date().toISOString(),
      metadata: {
        intent,
        side_effect_fingerprint: result.side_effect_fingerprint,
      },
    });
    return { ok: true, result };
  }
}
