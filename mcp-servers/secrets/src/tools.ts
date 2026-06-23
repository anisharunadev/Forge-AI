/**
 * MCP tool definitions + handlers for the FORA secrets-mcp.
 *
 * Two tools, per ADR-0003 §7 and the FORA-128 deliverable list:
 *
 *   - `resolve(secret_ref)`  → redacted envelope
 *   - `rotate(secret_ref, new_value)` → new version id
 *
 * Every input is a Zod schema; every response is a JSON-stringified
 * content block (MCP convention). The redacted envelope is the
 * `resolve` response — the raw value is never in the response.
 *
 * The model NEVER sees the `new_value` echoed back, even on a
 * successful rotate. The rotate response only carries the new
 * `version` id and a `created_at` timestamp.
 */

import { z } from "zod";
import type { SecretsBroker } from "./broker.js";

const ResolveInput = z.object({
  secret_ref: z
    .string()
    .min(1)
    .describe(
      "Tenant-scoped secret reference of the form " +
        '"tenants/{tenant_id}/secrets/{name}@{version}". ' +
        "Version is optional and defaults to 'latest'.",
    ),
});

const RotateInput = z.object({
  secret_ref: z
    .string()
    .min(1)
    .describe(
      "Tenant-scoped secret reference to rotate. " +
        "Version is ignored on rotate; a new version is always created.",
    ),
  new_value: z
    .string()
    .min(1)
    .describe(
      "The new raw value to write. The broker stores it; " +
        "the value is NOT echoed back in the response. The audit log " +
        "records the rotation event with the new version id but never " +
        "the value.",
    ),
});

const UseForInput = z.object({
  secret_ref: z
    .string()
    .min(1)
    .describe(
      "Tenant-scoped secret reference whose raw value the broker " +
        "will materialise at the last hop. The agent NEVER sees this " +
        "value — it is consumed by the registered handler in-process.",
    ),
  intent: z
    .string()
    .min(1)
    .describe(
      "The brokered action to perform. v1 ships: " +
        "'github.commit_sign', 'slack.webhook_post', 'aws.s3.put_object_signed'. " +
        "Unknown intents return code='unknown_intent'.",
    ),
  payload: z
    .record(z.string(), z.unknown())
    .describe(
      "Intent-specific data (commit message, channel/text, bucket/key, " +
        "etc.). Must be a plain object.",
    ),
});

export const toolDefinitions = [
  {
    name: "resolve",
    description:
      "Resolve a secret_ref and return a redacted envelope. The raw " +
      "value NEVER appears in the response — the agent sees only " +
      "{redacted, secret_ref, value_len, fingerprint, expires_at, " +
      "resolved_at, version}. For MCPs that need a raw value, use the " +
      "broker-side raw-use pattern: the agent passes an *intent* and the " +
      "broker performs the action; the value never enters the agent's " +
      "prompt or memory.",
    shape: {
      secret_ref: ResolveInput.shape.secret_ref,
    },
  },
  {
    name: "rotate",
    description:
      "Rotate a secret by writing a new version. The old version is " +
      "preserved and can be revoked independently of the new one. " +
      "The raw value is NOT echoed back in the response. The response " +
      "carries the new version id and a created_at timestamp.",
    shape: {
      secret_ref: RotateInput.shape.secret_ref,
      new_value: RotateInput.shape.new_value,
    },
  },
  {
    name: "use_for",
    description:
      "Broker-side raw-use pattern (FORA-128.f, ADR-0003 §7.2). The " +
      "agent passes an *intent* + *payload*; the broker resolves the " +
      "secret_ref, calls the registered handler in-process, and returns " +
      "ONLY the action's result. The raw value never enters the agent's " +
      "prompt, memory, or audit detail payload. The audit log records " +
      "`secret.used_for_<intent>` with the secret_ref + fingerprint. v1 " +
      "intents: github.commit_sign, slack.webhook_post, aws.s3.put_object_signed.",
    shape: {
      secret_ref: UseForInput.shape.secret_ref,
      intent: UseForInput.shape.intent,
      payload: UseForInput.shape.payload,
    },
  },
] as const;

export type ToolName = (typeof toolDefinitions)[number]["name"];

export async function handleToolCall(
  broker: SecretsBroker,
  name: ToolName | string,
  rawArgs: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  if (name === "resolve") {
    const args = ResolveInput.parse(rawArgs ?? {});
    const out = await broker.resolve(args.secret_ref);
    return {
      isError: !out.ok,
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  }
  if (name === "rotate") {
    const args = RotateInput.parse(rawArgs);
    const out = await broker.rotate(args.secret_ref, args.new_value);
    return {
      isError: !out.ok,
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  }
  if (name === "use_for") {
    const args = UseForInput.parse(rawArgs ?? {});
    const out = await broker.useFor(args.secret_ref, args.intent, args.payload);
    return {
      isError: !out.ok,
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  }
  throw new Error(`Unknown tool: ${name}.`);
}
