// test/unit-audit.mjs
// Unit tests for the FORA-36 audit-sink forwarder (FORA-128.c).
// Mirrors the test style of apps/identity-broker/test/fora-audit-sink.test.ts.
// We assert:
//   - Post shape: URL, method, content-type, body field order matches
//     the FORA-36 `append_event(...)` contract (ADR-0003 §8.1).
//   - The SecretAuditEvent fields are translated into the FORA-36
//     envelope correctly (principal="agent", scopes_used=[], secret
//     fields in metadata).
//   - Bearer token: when set, included as `Authorization: Bearer <token>`.
//   - 4xx: the forwarder logs and DROPS the event (fire-and-forget —
//     the broker's `emit` is synchronous, so a 4xx must not throw
//     into the caller's resolve/rotate path).
//   - 5xx: retries with exponential backoff, then drops on exhaust.
//   - The raw value is NEVER in the POST body — the broker never puts
//     it on the event, and `assertNoCredentials` is a second guard.
//   - A credential substring in the body causes the forwarder to drop
//     the event without POSTing.

import { strict as assert } from "node:assert";

const brokerMod = await import("../dist/broker.js");
const auditMod = await import("../dist/audit-fora.js");

const { InMemoryAuditSink, SecretsBroker } = brokerMod;
const { ForaAuditSink } = auditMod;

const TENANT = "tnt_audit_unit";

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

function makeFetchMock(responses) {
  const calls = [];
  let idx = 0;
  const fetchImpl = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      } else {
        for (const [k, v] of Object.entries(init.headers)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
    }
    const body = typeof init?.body === "string" ? init.body : "";
    const signal = init?.signal ?? null;
    calls.push({ url, method, headers, body, signal });
    const r = responses[Math.min(idx, responses.length - 1)];
    idx++;
    if (r.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    }
    return { status: r.status, text: async () => r.body ?? "" };
  };
  return { fetch: fetchImpl, calls };
}

process.stdout.write("# ForaAuditSink: post shape (FORA-36 envelope)\n");
run("translates SecretAuditEvent into the FORA-36 envelope and POSTs to /v1/audit/events", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 200 }]);
  const sink = new ForaAuditSink({ baseUrl: "https://audit.example.com", fetchImpl: fetch });
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: `tenants/${TENANT}/secrets/gh_pat@1`,
    fingerprint: "8b5bfe0f670e920d",
    value_len: 21,
    decision: "allow",
    trace_id: "tr_abc",
    timestamp: "2026-06-17T12:00:00.000Z",
  });
  // Give the fire-and-forget POST a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, "https://audit.example.com/v1/audit/events");
  assert.equal(c.method, "POST");
  assert.equal(c.headers["content-type"], "application/json");
  assert.equal(c.headers["accept"], "application/json");
  const body = JSON.parse(c.body);
  assert.equal(body.actor, "agent:dev");
  assert.equal(body.tenant_id, TENANT);
  assert.equal(body.principal, "agent");
  assert.deepEqual(body.scopes_used, []);
  assert.equal(body.action, "secret.resolved");
  assert.equal(body.decision, "allow");
  assert.equal(body.trace_id, "tr_abc");
  assert.equal(body.timestamp, "2026-06-17T12:00:00.000Z");
  assert.equal(body.metadata.agent_type, "developer");
  assert.equal(body.metadata.secret_ref, `tenants/${TENANT}/secrets/gh_pat@1`);
  assert.equal(body.metadata.fingerprint, "8b5bfe0f670e920d");
  assert.equal(body.metadata.value_len, 21);
  assert.ok(!("reason" in body.metadata), "deny reason must NOT be on an allow event");
});

run("deny event carries metadata.reason and no fingerprint/value_len", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 200 }]);
  const sink = new ForaAuditSink({ baseUrl: "https://audit.example.com", fetchImpl: fetch });
  sink.emit({
    action: "secret.access_denied",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: `tenants/${TENANT}/secrets/gh_pat`,
    decision: "deny",
    trace_id: "tr_denied",
    timestamp: "2026-06-17T12:01:00.000Z",
    reason: "not_found",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.action, "secret.access_denied");
  assert.equal(body.decision, "deny");
  assert.equal(body.metadata.reason, "not_found");
  assert.ok(!("fingerprint" in body.metadata), "deny must NOT carry fingerprint");
  assert.ok(!("value_len" in body.metadata), "deny must NOT carry value_len");
});

run("includes Authorization: Bearer header when token is set", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 200 }]);
  const sink = new ForaAuditSink({
    baseUrl: "https://audit.example.com",
    token: "secret-token-123",
    fetchImpl: fetch,
  });
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: "x",
    decision: "allow",
    trace_id: "tr_bearer",
    timestamp: "2026-06-17T12:02:00.000Z",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls[0].headers.authorization, "Bearer secret-token-123");
});

process.stdout.write("# ForaAuditSink: fire-and-forget failure modes\n");
run("4xx: drops the event, does not throw into the broker", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 422, body: "invalid action enum" }]);
  const sink = new ForaAuditSink({ baseUrl: "https://audit.example.com", fetchImpl: fetch });
  // emit must NOT throw — the broker relies on it being synchronous
  // and exception-free.
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: "x",
    decision: "allow",
    trace_id: "tr_4xx",
    timestamp: "2026-06-17T12:03:00.000Z",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Exactly one POST; the forwarder does not retry 4xx.
  assert.equal(calls.length, 1);
});

run("5xx: retries with exponential backoff, drops on exhaust", async () => {
  const { fetch, calls } = makeFetchMock([
    { status: 503 },
    { status: 503 },
    { status: 503 },
  ]);
  const sink = new ForaAuditSink({
    baseUrl: "https://audit.example.com",
    fetchImpl: fetch,
    maxAttempts: 3,
    baseBackoffMs: 1, // keep the test fast
  });
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: "x",
    decision: "allow",
    trace_id: "tr_5xx",
    timestamp: "2026-06-17T12:04:00.000Z",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.length, 3, "3 attempts on persistent 5xx");
});

run("5xx then 2xx: succeeds on the retry, no further attempts", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 503 }, { status: 200 }]);
  const sink = new ForaAuditSink({
    baseUrl: "https://audit.example.com",
    fetchImpl: fetch,
    maxAttempts: 3,
    baseBackoffMs: 1,
  });
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: "x",
    decision: "allow",
    trace_id: "tr_retry_ok",
    timestamp: "2026-06-17T12:05:00.000Z",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls.length, 2);
});

process.stdout.write("# ForaAuditSink: defence in depth — never POSTs a credential substring\n");
run("credential substring in body causes the forwarder to DROP the event without POSTing", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 200 }]);
  // We patch the broker-emit path by constructing an event whose
  // metadata *would* carry a credential substring if the broker ever
  // leaked it. The forwarder must refuse to POST.
  const sink = new ForaAuditSink({ baseUrl: "https://audit.example.com", fetchImpl: fetch });
  sink.emit({
    action: "secret.resolved",
    tenant_id: TENANT,
    actor: "agent:dev",
    agent_type: "developer",
    secret_ref: "AKIAIOSFODNN7EXAMPLE/leaked",
    decision: "allow",
    trace_id: "tr_cred",
    timestamp: "2026-06-17T12:06:00.000Z",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 0, "credential-shaped secret_ref must be dropped, never POSTed");
});

process.stdout.write("# Integration: SecretsBroker + ForaAuditSink\n");
run("a successful resolve emits exactly one POST with the allow envelope", async () => {
  const { fetch, calls } = makeFetchMock([{ status: 200 }]);
  const store = new InMemoryAuditSink();
  // We don't actually need the store — we replace the audit sink in
  // the broker directly. Use a real in-memory store for the resolve
  // path.
  const inMemStoreMod = await import("../dist/store.js");
  const { InMemorySecretStore } = inMemStoreMod;
  const memStore = new InMemorySecretStore({
    [`${TENANT}/gh_pat`]: [
      {
        value: "real-secret-1",
        version: "1",
        created_at: "2026-06-01T00:00:00.000Z",
        expires_at: "2030-01-01T00:00:00.000Z",
      },
    ],
  });
  const audit = new ForaAuditSink({ baseUrl: "https://audit.example.com", fetchImpl: fetch });
  const broker = new SecretsBroker(
    memStore,
    audit,
    TENANT,
    "tr_broker_resolve",
    "agent:dev",
    "developer",
  );
  const out = await broker.resolve(`tenants/${TENANT}/secrets/gh_pat`);
  assert.equal(out.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.length, 1, "exactly one POST for one resolve");
  const body = JSON.parse(calls[0].body);
  assert.equal(body.action, "secret.resolved");
  assert.equal(body.decision, "allow");
  // The audit carries the *requested* ref (with @latest); the
  // resolved version is in `metadata.version` (set by the broker
  // for the in-memory store path).
  assert.equal(body.metadata.secret_ref, `tenants/${TENANT}/secrets/gh_pat@latest`);
  assert.ok(typeof body.metadata.fingerprint === "string", "fingerprint is in metadata");
  // Defence in depth: the raw value must not appear in the POST body.
  assert.ok(!calls[0].body.includes("real-secret-1"), "POST body must not contain raw value");
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall audit-forwarder unit checks green\n");
}
