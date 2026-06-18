/**
 * Broker-side raw-use pattern (FORA-128.f, ADR-0003 §7.2).
 *
 * The agent never calls `resolve` for MCPs that need a raw value
 * (signing a commit, posting a Slack webhook, uploading to S3 with
 * a tenant key). The agent calls the *target* MCP with an *intent*;
 * the broker materialises the secret at the last hop, performs the
 * action, and returns only the action's result. The raw value
 * never enters the agent's prompt, memory, or audit detail payload.
 *
 * ## Shape
 *
 *   1. The agent calls `secrets-mcp::use_for({ secret_ref, intent,
 *      payload })` with `intent` from a registered enum and
 *      `payload` the action-specific data.
 *   2. The broker parses + validates the secret_ref (rejecting
 *      cross-tenant with `tenant_scope`).
 *   3. The broker resolves the secret at the store layer.
 *   4. The broker looks up the registered handler for `intent` and
 *      calls it with `(value, payload)` in-process. The handler
 *      performs the side effect (HTTP POST, S3 PUT, etc.) and
 *      returns the action's result envelope. The handler MUST NOT
 *      return the raw value or any derivative that recovers it.
 *   5. The broker emits `secret.used_for_<intent>` with the
 *      `secret_ref` + `fingerprint` and returns the handler's
 *      result to the agent. The raw value is dropped at this point.
 *
 * ## v1 scope
 *
 * This module ships the **interface** and **registry** + three
 * stub handlers (`commit_sign`, `webhook_post`, `s3_put_object`)
 * that the integration suite exercises. The production wiring of
 * the three concrete brokered actions (GitHub commit signing, Slack
 * webhook post, AWS S3 PUT) is a follow-up — the auth-engineer
 * hire owns the side-effecting clients (see FORA-189 acceptance
 * criteria). The interface and audit event shape are the contract
 * every follow-up handler must honour; changing the audit event
 * name is a one-way door (ADR-0003 §10 sub-decision 4).
 */

import { createHash } from "node:crypto";

/** The set of brokered intents the registry knows about. New intents
 *  are added by registering a handler at boot; the closed union here
 *  is the *default* set the v0 integration tests exercise. */
export type BrokeredIntent =
  | "github.commit_sign"
  | "slack.webhook_post"
  | "aws.s3.put_object_signed";

/** The result envelope the agent sees. The handler returns this
 *  shape; the broker passes it through. The raw value is NEVER in
 *  this envelope. */
export interface BrokeredActionResult {
  intent: BrokeredIntent;
  /** The action-specific result (commit SHA, webhook response
   *  status, S3 URI, etc.). The handler defines the inner shape. */
  result: Record<string, unknown>;
  /** A non-reversible digest of the side effect (e.g. the commit
   *  SHA, the S3 object ETag). Useful for the agent to reason
   *  about idempotency without re-running the action. */
  side_effect_fingerprint: string;
}

/** The handler signature. Receives the resolved value + the
 *  agent's payload, returns the result envelope. The handler MUST
 *  NOT return the raw value or anything that recovers it. */
export type BrokeredHandler = (
  value: string,
  payload: Record<string, unknown>,
) => Promise<BrokeredActionResult>;

/** Validation: payload must be a plain object (not null, not array). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/** Handler registry. The integration test wires stub handlers; the
 *  production wiring is a follow-up (see file header). */
export class BrokeredActionRegistry {
  private readonly handlers: Map<BrokeredIntent, BrokeredHandler> = new Map();

  register(intent: BrokeredIntent, handler: BrokeredHandler): void {
    if (this.handlers.has(intent)) {
      throw new Error(
        `BrokeredActionRegistry: intent '${intent}' is already registered`,
      );
    }
    this.handlers.set(intent, handler);
  }

  has(intent: BrokeredIntent): boolean {
    return this.handlers.has(intent);
  }

  /** `intent` is accepted as a string at the boundary; the registry
   *  throws `UnknownIntentError` if no handler is registered. The
   *  payload must be a plain object; anything else throws
   *  `InvalidPayloadError`. The handler is called with the value
   *  in-process — it is the only thing that sees the raw value. */
  async invoke(
    intent: string,
    value: string,
    payload: unknown,
  ): Promise<BrokeredActionResult> {
    const h = this.handlers.get(intent as BrokeredIntent);
    if (!h) {
      throw new UnknownIntentError(intent);
    }
    if (!isPlainObject(payload)) {
      throw new InvalidPayloadError(
        `payload for intent '${intent}' must be a plain object`,
      );
    }
    return h(value, payload);
  }

  /** List the registered intents. Useful for the MCP tool description
   *  so the model knows what's available. */
  list(): BrokeredIntent[] {
    return [...this.handlers.keys()];
  }
}

export class UnknownIntentError extends Error {
  constructor(public readonly intent: string) {
    super(`No handler registered for brokered intent '${intent}'.`);
    this.name = "UnknownIntentError";
  }
}

export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPayloadError";
  }
}

// ─────────────────────────────────────────────────────────────────────
// v1 stub handlers.
//
// These three handlers are the integration-test default: they take
// the resolved secret value and produce a deterministic, side-effect-
// free result. The PRODUCTION wiring of each handler (a real GitHub
// commit-signing call, a real Slack webhook POST, a real S3 PUT) is
// a follow-up owned by the `auth-engineer` hire. The shape of the
// result envelope is the contract; replacing the stub with a real
// implementation must keep `side_effect_fingerprint` deterministic
// for the same inputs.
//
// Each handler:
//   - takes the secret value (used only as input to a hash; the
//     stub never echoes it back);
//   - takes the payload (intent-specific);
//   - returns a `BrokeredActionResult` with the action's natural
//     result and a `side_effect_fingerprint`.
//
// The stub for `github.commit_sign` hashes the value into a fake
// "commit SHA" so the integration test can assert determinism. The
// stub for `slack.webhook_post` returns a fake HTTP status. The
// stub for `aws.s3.put_object_signed` returns a fake S3 URI.
// ─────────────────────────────────────────────────────────────────────

function fingerprintResult(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 16);
}

export const stubCommitSignHandler: BrokeredHandler = async (value, payload) => {
  const message = typeof payload.message === "string" ? payload.message : "";
  // Hash value+message to produce a deterministic 40-char fake SHA.
  const sha = createHash("sha1")
    .update(value, "utf8")
    .update("\n", "utf8")
    .update(message, "utf8")
    .digest("hex");
  return {
    intent: "github.commit_sign",
    result: { commit_sha: sha, signed_by: "stub-handler" },
    side_effect_fingerprint: fingerprintResult("github.commit_sign", sha),
  };
};

export const stubWebhookPostHandler: BrokeredHandler = async (value, payload) => {
  const channel = typeof payload.channel === "string" ? payload.channel : "";
  const text = typeof payload.text === "string" ? payload.text : "";
  // Pretend to POST; the stub never opens a socket.
  const status = 200;
  return {
    intent: "slack.webhook_post",
    result: { ok: true, status, channel },
    side_effect_fingerprint: fingerprintResult("slack.webhook_post", channel, text, value),
  };
};

export const stubS3PutObjectHandler: BrokeredHandler = async (value, payload) => {
  const bucket = typeof payload.bucket === "string" ? payload.bucket : "";
  const key = typeof payload.key === "string" ? payload.key : "";
  // ETag is a deterministic digest of (value, key) — the real
  // implementation should use the S3-returned ETag, but for the
  // stub we want idempotency on retry.
  const etag = createHash("md5")
    .update(value, "utf8")
    .update("\n", "utf8")
    .update(key, "utf8")
    .digest("hex");
  return {
    intent: "aws.s3.put_object_signed",
    result: {
      s3_uri: `s3://${bucket}/${key}`,
      etag,
    },
    side_effect_fingerprint: fingerprintResult("aws.s3.put_object_signed", bucket, key, etag),
  };
};

/** Build the default v1 registry with the three stub handlers. The
 *  integration tests use this; production wiring is a follow-up. */
export function defaultBrokeredActionRegistry(): BrokeredActionRegistry {
  const r = new BrokeredActionRegistry();
  r.register("github.commit_sign", stubCommitSignHandler);
  r.register("slack.webhook_post", stubWebhookPostHandler);
  r.register("aws.s3.put_object_signed", stubS3PutObjectHandler);
  return r;
}
