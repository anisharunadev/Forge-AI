// test/unit-brokered.mjs
// Unit tests for the broker-side raw-use pattern (FORA-128.f).
// Coverage:
//   - registry registration, unknown intent, invalid payload.
//   - SecretsBroker.useFor resolves, invokes handler in-process,
//     returns only the action's result envelope.
//   - The raw value is NEVER in the response, the audit event, or
//     any test introspection.
//   - The audit event is `secret.used_for_<intent>` with the
//     secret_ref + fingerprint, never the value.

import { strict as assert } from "node:assert";

const brokerMod = await import("../dist/broker.js");
const storeMod = await import("../dist/store.js");
const refMod = await import("../dist/secret_ref.js");
const brokeredMod = await import("../dist/brokered.js");

const { SecretsBroker, InMemoryAuditSink } = brokerMod;
const { InMemorySecretStore } = storeMod;
const { fingerprint } = refMod;
const {
  BrokeredActionRegistry,
  defaultBrokeredActionRegistry,
  UnknownIntentError,
  InvalidPayloadError,
  stubCommitSignHandler,
} = brokeredMod;

const TENANT = "tnt_brokered_unit";
const OTHER = "tnt_other";
const RAW_V1 = "gh_pat_RAW_DO_NOT_LEAK_xxxxxxxxxxxxxx";

function run(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => process.stdout.write(`  ok  ${name}\n`),
        (err) => {
          process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
          process.exitCode = 1;
        },
      );
    }
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("# BrokeredActionRegistry\n");
run("registers a handler and rejects duplicate registration", () => {
  const r = new BrokeredActionRegistry();
  r.register("github.commit_sign", stubCommitSignHandler);
  assert.equal(r.has("github.commit_sign"), true);
  assert.throws(() => r.register("github.commit_sign", stubCommitSignHandler), /already registered/);
});

run("invoke throws UnknownIntentError for an unknown intent", async () => {
  const r = new BrokeredActionRegistry();
  await assert.rejects(
    () => r.invoke("not.an.intent", "value", { x: 1 }),
    (err) => err instanceof UnknownIntentError,
    "expected UnknownIntentError",
  );
});

run("invoke throws InvalidPayloadError for a non-object payload", async () => {
  const r = new BrokeredActionRegistry();
  r.register("github.commit_sign", stubCommitSignHandler);
  await assert.rejects(
    () => r.invoke("github.commit_sign", "value", "not-an-object"),
    (err) => err instanceof InvalidPayloadError,
    "expected InvalidPayloadError",
  );
  await assert.rejects(
    () => r.invoke("github.commit_sign", "value", null),
    (err) => err instanceof InvalidPayloadError,
  );
  await assert.rejects(
    () => r.invoke("github.commit_sign", "value", [1, 2, 3]),
    (err) => err instanceof InvalidPayloadError,
  );
});

process.stdout.write("# SecretsBroker.useFor — in-process handler invocation\n");
function newBroker(tenantClaim = TENANT) {
  const store = new InMemorySecretStore({
    [`${TENANT}/gh_pat`]: [
      {
        value: RAW_V1,
        version: "1",
        created_at: "2026-06-01T00:00:00.000Z",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
    ],
  });
  const audit = new InMemoryAuditSink();
  const registry = defaultBrokeredActionRegistry();
  const broker = new SecretsBroker(
    store,
    audit,
    tenantClaim,
    "trace-brokered",
    "agent:dev",
    "developer",
    registry,
  );
  return { broker, audit, registry };
}

run("useFor invokes the handler and returns the action result; raw value never in response", async () => {
  const { broker, audit } = newBroker();
  const out = await broker.useFor(
    `tenants/${TENANT}/secrets/gh_pat`,
    "github.commit_sign",
    { message: "fix: typo" },
  );
  assert.equal(out.ok, true);
  assert.equal(out.result.intent, "github.commit_sign");
  assert.match(out.result.result.commit_sha, /^[0-9a-f]{40}$/);
  // Defence in depth: the response is JSON-serialised; the raw
  // value MUST NOT be anywhere in it.
  const resp = JSON.stringify(out);
  assert.ok(!resp.includes(RAW_V1), "response must not contain raw value");
  // Audit: secret.used_for_github.commit_sign with secret_ref + fingerprint.
  assert.equal(audit.events.length, 1);
  const ev = audit.events[0];
  assert.equal(ev.action, "secret.used_for_github.commit_sign");
  assert.equal(ev.decision, "allow");
  assert.equal(ev.fingerprint, fingerprint(RAW_V1));
  const evJson = JSON.stringify(ev);
  assert.ok(!evJson.includes(RAW_V1), "audit event must not contain raw value");
  assert.equal(ev.metadata.intent, "github.commit_sign");
  assert.equal(ev.metadata.side_effect_fingerprint, out.result.side_effect_fingerprint);
});

run("useFor cross-tenant ref is rejected with tenant_scope; raw value never logged", async () => {
  const { broker, audit } = newBroker();
  const out = await broker.useFor(
    `tenants/${OTHER}/secrets/gh_pat`,
    "github.commit_sign",
    { message: "x" },
  );
  assert.equal(out.ok, false);
  assert.equal(out.code, "tenant_scope");
  assert.equal(audit.events[0].action, "secret.access_denied");
  assert.equal(audit.events[0].reason, "tenant_scope");
  const evJson = JSON.stringify(audit.events[0]);
  assert.ok(!evJson.includes(RAW_V1), "audit must not contain raw value");
});

run("useFor unknown intent returns code=unknown_intent", async () => {
  const { broker, audit } = newBroker();
  const out = await broker.useFor(
    `tenants/${TENANT}/secrets/gh_pat`,
    "unknown.intent",
    { x: 1 },
  );
  assert.equal(out.ok, false);
  assert.equal(out.code, "unknown_intent");
  assert.equal(audit.events[0].action, "secret.access_denied");
});

run("slack.webhook_post handler runs and returns a non-leaking envelope", async () => {
  const { broker, audit } = newBroker();
  const out = await broker.useFor(
    `tenants/${TENANT}/secrets/gh_pat`,
    "slack.webhook_post",
    { channel: "#deploys", text: "shipped v1.2" },
  );
  assert.equal(out.ok, true);
  assert.equal(out.result.intent, "slack.webhook_post");
  assert.equal(out.result.result.ok, true);
  assert.equal(out.result.result.channel, "#deploys");
  const resp = JSON.stringify(out);
  assert.ok(!resp.includes(RAW_V1), "response must not contain raw value");
  assert.equal(audit.events[0].action, "secret.used_for_slack.webhook_post");
});

run("aws.s3.put_object_signed handler returns an S3 URI; raw value never in response", async () => {
  const { broker, audit } = newBroker();
  const out = await broker.useFor(
    `tenants/${TENANT}/secrets/gh_pat`,
    "aws.s3.put_object_signed",
    { bucket: "my-bucket", key: "reports/q2.pdf" },
  );
  assert.equal(out.ok, true);
  assert.equal(out.result.intent, "aws.s3.put_object_signed");
  assert.equal(out.result.result.s3_uri, "s3://my-bucket/reports/q2.pdf");
  assert.match(out.result.result.etag, /^[0-9a-f]{32}$/);
  const resp = JSON.stringify(out);
  assert.ok(!resp.includes(RAW_V1), "response must not contain raw value");
  assert.equal(audit.events[0].action, "secret.used_for_aws.s3.put_object_signed");
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall brokered-action unit checks green\n");
}
