// test/unit-aws.mjs
// Unit tests for the AWS Secrets Manager backing store
// (src/store-aws.ts). The store is exercised through the test seam
// `clientFactory` so the tests run offline — no real AWS account is
// needed. The test mirrors the production redacted-envelope contract
// (per ADR-0003 §7) and asserts:
//   - GetSecretValue at @latest returns the redacted envelope.
//   - GetSecretValue at @<n> returns the right version.
//   - PutSecretValue creates a new integer version and an old
//     version is still resolvable.
//   - Cross-tenant ref is rejected BEFORE we call AWS.
//   - ResourceNotFoundException is mapped to SecretNotFoundError.
//   - The raw value never appears in the redacted envelope or any
//     audit event.

import { strict as assert } from "node:assert";

const refMod = await import("../dist/secret_ref.js");
const storeMod = await import("../dist/store.js");
const awsMod = await import("../dist/store-aws.js");
const brokerMod = await import("../dist/broker.js");

const { parseSecretRef, fingerprint } = refMod;
const { TenantScopeError, SecretNotFoundError } = storeMod;
const { AwsSecretsManagerStore } = awsMod;
const { SecretsBroker, InMemoryAuditSink } = brokerMod;

const TENANT = "tnt_aws_unit";
const RAW_V1 = "AKIA-FIXTURE-VALUE-ONE-DO-NOT-USE";
const RAW_V2 = "AKIA-FIXTURE-VALUE-TWO-DO-NOT-USE";

/** A minimal fake SecretsManagerClientLike that records the calls and
 *  returns canned responses for GetSecretValue / PutSecretValue. */
function makeFakeClient() {
  const calls = [];
  // Simulated AWS SM state: { [smName]: { versions: { [VersionId]: { value, created } } } }
  const state = new Map();

  function ensure(name) {
    let s = state.get(name);
    if (!s) {
      s = { versions: new Map() };
      state.set(name, s);
    }
    return s;
  }

  function getCommandName(cmd) {
    return cmd?.constructor?.name ?? "";
  }

  return {
    calls,
    state,
    async send(command) {
      const name = getCommandName(command);
      const input = command?.input ?? {};
      calls.push({ name, input });

      if (name === "GetSecretValueCommand") {
        const s = state.get(input.SecretId);
        if (!s || s.versions.size === 0) {
          const err = new Error(
            `Secrets Manager can't find the specified secret. (Name: ${input.SecretId})`,
          );
          err.name = "ResourceNotFoundException";
          throw err;
        }
        let versionId = input.VersionId;
        if (!versionId) {
          // AWSCURRENT → pick the most-recently-stored version.
          versionId = [...s.versions.keys()].at(-1);
        }
        const v = s.versions.get(versionId);
        if (!v) {
          const err = new Error(
            `Secrets Manager can't find the specified version. (VersionId: ${versionId})`,
          );
          err.name = "ResourceNotFoundException";
          throw err;
        }
        return {
          SecretString: v.value,
          VersionId: versionId,
          CreatedDate: new Date(v.created),
          $metadata: { httpStatusCode: 200 },
        };
      }

      if (name === "PutSecretValueCommand") {
        const s = ensure(input.SecretId);
        const newId = `aws-uuid-${s.versions.size + 1}`;
        const created = new Date("2026-06-17T16:40:00.000Z").toISOString();
        s.versions.set(newId, { value: input.SecretString, created });
        return { VersionId: newId, $metadata: { httpStatusCode: 200 } };
      }

      throw new Error(`fake client: unsupported command ${name}`);
    },
  };
}

/** Stub clock so created_at is deterministic. */
const fixedNow = () => new Date("2026-06-17T16:40:00.000Z");

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

process.stdout.write("# AwsSecretsManagerStore: cross-tenant guard\n");
run("cross-tenant ref is rejected before any AWS call", async () => {
  const fake = makeFakeClient();
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  await assert.rejects(
    () => store.read(parseSecretRef(`tenants/tnt_other/secrets/gh_pat`), TENANT),
    (err) => err instanceof TenantScopeError,
    "expected TenantScopeError",
  );
  assert.equal(fake.calls.length, 0, "no AWS call should be made on cross-tenant");
});

process.stdout.write("# AwsSecretsManagerStore: read / rotate / version pinning\n");
run("resolve at @latest returns the redacted envelope", async () => {
  const fake = makeFakeClient();
  // Seed: a single version.
  fake.state.set(`fora/${TENANT}/gh_pat`, {
    versions: new Map([["aws-uuid-1", { value: RAW_V1, created: "2026-06-01T00:00:00.000Z" }]]),
  });
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  const ref = parseSecretRef(`tenants/${TENANT}/secrets/gh_pat`);
  const v = await store.read(ref, TENANT);
  assert.equal(v.value, RAW_V1);
  assert.equal(v.version, "1", "first read of a seeded secret returns integer version 1");
  // Read again to make sure reads of the same AWS version are idempotent.
  const v2 = await store.read(ref, TENANT);
  assert.equal(v2.value, RAW_V1, "second read sees the same value");
  assert.equal(v2.version, "1", "second read of the same AWS version keeps integer version 1");
});

run("rotate writes a new version; old version is still resolvable", async () => {
  const fake = makeFakeClient();
  fake.state.set(`fora/${TENANT}/gh_pat`, {
    versions: new Map([["aws-uuid-1", { value: RAW_V1, created: "2026-06-01T00:00:00.000Z" }]]),
  });
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  const ref = parseSecretRef(`tenants/${TENANT}/secrets/gh_pat`);
  // First read primes the integer version counter at 1.
  await store.read(ref, TENANT);
  // Rotate creates version 2.
  const r = await store.rotate(ref, TENANT, RAW_V2);
  assert.equal(r.version, "2");
  // @latest → version 2 (RAW_V2)
  const latest = await store.read(ref, TENANT);
  assert.equal(latest.value, RAW_V2);
  assert.equal(latest.version, "2");
  // @1 → version 1 (RAW_V1)
  const v1 = await store.read({ ...ref, version: "1" }, TENANT);
  assert.equal(v1.value, RAW_V1);
  assert.equal(v1.version, "1");
});

run("ResourceNotFoundException is mapped to SecretNotFoundError", async () => {
  const fake = makeFakeClient();
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  const ref = parseSecretRef(`tenants/${TENANT}/secrets/does_not_exist`);
  await assert.rejects(
    () => store.read(ref, TENANT),
    (err) => err instanceof SecretNotFoundError,
    "expected SecretNotFoundError",
  );
});

process.stdout.write("# AwsSecretsManagerStore + SecretsBroker integration\n");
run("broker.resolve returns a redacted envelope; raw value is never in the response or audit", async () => {
  const fake = makeFakeClient();
  fake.state.set(`fora/${TENANT}/gh_pat`, {
    versions: new Map([["aws-uuid-1", { value: RAW_V1, created: "2026-06-01T00:00:00.000Z" }]]),
  });
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  const audit = new InMemoryAuditSink();
  const broker = new SecretsBroker(
    store,
    audit,
    TENANT,
    "trace-aws",
    "agent:aws-test",
    "deploy-agent",
  );
  const out = await broker.resolve(`tenants/${TENANT}/secrets/gh_pat`);
  assert.equal(out.ok, true);
  const env = out.envelope;
  assert.equal(env.redacted, true);
  assert.equal(env.secret_ref, `tenants/${TENANT}/secrets/gh_pat@1`, "envelope echoes the resolved version");
  assert.equal(env.value_len, RAW_V1.length);
  assert.equal(env.fingerprint, fingerprint(RAW_V1));
  const envJson = JSON.stringify(env);
  assert.ok(!envJson.includes(RAW_V1), "envelope must not contain raw value");
  // Audit must not contain raw value either.
  const auditJson = JSON.stringify(audit.events);
  assert.ok(!auditJson.includes(RAW_V1), "audit must not contain raw value");
  assert.equal(audit.events[0].action, "secret.resolved");
  assert.equal(audit.events[0].decision, "allow");
  // The audit records the *requested* ref (with @latest). The
  // resolved integer version lives in `metadata.version` per the
  // contract — the audit captures the fact, the envelope captures
  // the value-derived metadata.
  assert.equal(
    audit.events[0].secret_ref,
    `tenants/${TENANT}/secrets/gh_pat@latest`,
  );
  assert.equal(audit.events[0].metadata.version, "1");
  assert.equal(audit.events[0].fingerprint, fingerprint(RAW_V1));
});

run("broker.rotate through AWS emits secret.rotated with the integer version", async () => {
  const fake = makeFakeClient();
  fake.state.set(`fora/${TENANT}/gh_pat`, {
    versions: new Map([["aws-uuid-1", { value: RAW_V1, created: "2026-06-01T00:00:00.000Z" }]]),
  });
  const store = new AwsSecretsManagerStore({
    region: "us-east-1",
    tenantClaim: TENANT,
    clientFactory: () => fake,
    now: fixedNow,
  });
  const audit = new InMemoryAuditSink();
  const broker = new SecretsBroker(
    store,
    audit,
    TENANT,
    "trace-aws",
    "agent:aws-test",
    "deploy-agent",
  );
  // Prime the version counter by reading the seeded secret first —
  // realistic flow is: tenant provisions in AWS SM, agent reads v1,
  // agent rotates, agent gets v2.
  const r0 = await broker.resolve(`tenants/${TENANT}/secrets/gh_pat`);
  assert.equal(r0.envelope.version, "1", "prime read returns version 1");
  const r = await broker.rotate(`tenants/${TENANT}/secrets/gh_pat`, RAW_V2);
  assert.equal(r.ok, true);
  assert.equal(r.version, "2", "rotate after prime read produces version 2");
  const auditJson = JSON.stringify(audit.events);
  assert.ok(!auditJson.includes(RAW_V2), "rotate audit must not contain new_value");
  // Two audit events: one resolve (allow) + one rotate (allow).
  assert.equal(audit.events.length, 2);
  assert.equal(audit.events[0].action, "secret.resolved");
  assert.equal(audit.events[1].action, "secret.rotated");
  assert.equal(audit.events[1].metadata.version, "2");
});

if (process.exitCode) {
  process.stdout.write("\nFAILED\n");
} else {
  process.stdout.write("\nall aws-store unit checks green\n");
}
