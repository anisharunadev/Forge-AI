// test/unit.mjs
// Pure-JS unit tests for the secrets-mcp grammar + redacted envelope.
// We exercise the compiled dist/ output so the test mirrors the
// production path; the smoke test (test/smoke.mjs) exercises the
// MCP transport in a child process.
//
// Coverage:
//   - parseSecretRef: valid forms, version default, malformed.
//   - redact: shape invariants, fingerprint stability, no raw value.
//   - SecretsBroker: resolve success, not_found, invalid_ref,
//     cross-tenant, rotate success + audit event shape.

import { strict as assert } from "node:assert";

// Import the library modules directly — NOT the server entry
// point (dist/index.js) which boots a config check and requires
// the FORA_TENANT_ID env var. The library is the unit; the server
// is the integration.
const brokerMod = await import("../dist/broker.js");
const refMod = await import("../dist/secret_ref.js");
const storeMod = await import("../dist/store.js");

const {
  parseSecretRef,
  formatSecretRef,
  redact,
  fingerprint,
} = refMod;
const { InMemorySecretStore, TenantScopeError, SecretNotFoundError } = storeMod;
const { SecretsBroker, InMemoryAuditSink } = brokerMod;

function run(name, fn) {
  try {
    fn();
    process.stdout.write(`  ok  ${name}\n`);
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n    ${err.stack ?? err.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("# parseSecretRef\n");
run("accepts tenants/{tid}/secrets/{name}", () => {
  const ref = parseSecretRef("tenants/tnt_8XQ/secrets/gh_pat");
  assert.equal(ref.tenant_id, "tnt_8XQ");
  assert.equal(ref.name, "gh_pat");
  assert.equal(ref.version, "latest");
});
run("accepts tenants/{tid}/secrets/{name}@{version}", () => {
  const ref = parseSecretRef("tenants/tnt_8XQ/secrets/gh_pat@3");
  assert.equal(ref.version, "3");
});
run("rejects the customer-facing secrets/ prefix", () => {
  // v0 only supports the full `tenants/{tid}/secrets/{name}@{v}` form.
  // The short form is reserved for a future ADR (per ADR-0003 §10
  // sub-decision 4, the grammar is a one-way door and any extension
  // is a new ADR, not a parser change).
  assert.throws(
    () => parseSecretRef("secrets/gh_pat"),
    /Invalid secret_ref/,
    "should reject: secrets/gh_pat",
  );
});
run("rejects malformed refs", () => {
  for (const bad of [
    "",
    "tenants/",
    "tenants/tnt_8XQ",
    "tenants/tnt_8XQ/secrets",
    "tenants/tnt_8XQ/secrets/",
    "tenants/bad tenant id/secrets/gh_pat",
    "tenants/tnt_8XQ/secrets/gh_pat@zero",
    "tenants/tnt_8XQ/secrets/gh_pat@-1",
  ]) {
    assert.throws(() => parseSecretRef(bad), /Invalid secret_ref/, `should reject: ${JSON.stringify(bad)}`);
  }
});

process.stdout.write("# formatSecretRef\n");
run("round-trips parse → format → parse", () => {
  const a = parseSecretRef("tenants/tnt_8XQ/secrets/gh_pat@7");
  const b = parseSecretRef(formatSecretRef(a));
  assert.deepEqual(a, b);
});

process.stdout.write("# fingerprint + redact\n");
run("fingerprint is a 16-char hex digest and stable", () => {
  const a = fingerprint("hello world");
  const b = fingerprint("hello world");
  const c = fingerprint("hello worlD");
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
run("redact never includes the raw value", () => {
  const ref = parseSecretRef("tenants/tnt_8XQ/secrets/gh_pat");
  const env = redact(ref, "super-secret-value", "2030-01-01T00:00:00.000Z");
  assert.equal(env.redacted, true);
  assert.equal(env.value_len, "super-secret-value".length);
  assert.equal(env.fingerprint, fingerprint("super-secret-value"));
  assert.equal(env.expires_at, "2030-01-01T00:00:00.000Z");
  const json = JSON.stringify(env);
  assert.ok(!json.includes("super-secret-value"), "redacted envelope must not contain the raw value");
});

process.stdout.write("# SecretsBroker + InMemorySecretStore\n");
const TENANT = "tnt_unit";
const OTHER = "tnt_other";
const seed = {
  [`${TENANT}/existing`]: [
    {
      value: "real-secret-1",
      version: "1",
      created_at: "2026-06-01T00:00:00.000Z",
      expires_at: "2030-01-01T00:00:00.000Z",
    },
  ],
};

function newBroker(tenantClaim) {
  const store = new InMemorySecretStore(seed);
  const audit = new InMemoryAuditSink();
  const broker = new SecretsBroker(
    store,
    audit,
    tenantClaim,
    "trace-test",
    "agent:test",
    "developer",
  );
  return { broker, audit };
}

run("resolve returns a redacted envelope on success", async () => {
  const { broker, audit } = newBroker(TENANT);
  const out = await broker.resolve(`tenants/${TENANT}/secrets/existing`);
  assert.equal(out.ok, true);
  assert.equal(out.envelope.redacted, true);
  assert.equal(out.envelope.value_len, "real-secret-1".length);
  assert.equal(out.envelope.fingerprint, fingerprint("real-secret-1"));
  // Audit fired.
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].action, "secret.resolved");
  assert.equal(audit.events[0].decision, "allow");
  // Audit never carries the raw value.
  assert.ok(!JSON.stringify(audit.events[0]).includes("real-secret-1"));
});

run("resolve returns not_found when the secret is missing", async () => {
  const { broker, audit } = newBroker(TENANT);
  const out = await broker.resolve(`tenants/${TENANT}/secrets/missing`);
  assert.equal(out.ok, false);
  assert.equal(out.code, "not_found");
  assert.equal(audit.events[0].action, "secret.access_denied");
  assert.equal(audit.events[0].reason, "not_found");
});

run("resolve returns invalid_ref on a malformed ref", async () => {
  const { broker, audit } = newBroker(TENANT);
  const out = await broker.resolve("not-a-ref");
  assert.equal(out.ok, false);
  assert.equal(out.code, "invalid_ref");
  assert.equal(audit.events[0].action, "secret.access_denied");
  assert.equal(audit.events[0].reason, "invalid_ref");
});

run("cross-tenant ref is rejected with tenant_scope", async () => {
  const { broker, audit } = newBroker(TENANT);
  const out = await broker.resolve(`tenants/${OTHER}/secrets/existing`);
  assert.equal(out.ok, false);
  assert.equal(out.code, "tenant_scope");
  assert.equal(audit.events[0].action, "secret.access_denied");
  assert.equal(audit.events[0].reason, "tenant_scope");
});

run("rotate writes a new version and emits secret.rotated", async () => {
  const { broker, audit } = newBroker(TENANT);
  const out = await broker.rotate(`tenants/${TENANT}/secrets/existing`, "new-secret-2");
  assert.equal(out.ok, true);
  assert.equal(out.version, "2");
  assert.equal(audit.events[0].action, "secret.rotated");
  // The old version is preserved: a @1 resolve still works.
  const r1 = await broker.resolve(`tenants/${TENANT}/secrets/existing@1`);
  assert.equal(r1.envelope.fingerprint, fingerprint("real-secret-1"));
  // @latest returns the new value's fingerprint.
  const r2 = await broker.resolve(`tenants/${TENANT}/secrets/existing`);
  assert.equal(r2.envelope.fingerprint, fingerprint("new-secret-2"));
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall unit checks green\n");
}
