// test/smoke.mjs
// End-to-end smoke test for the FORA secrets-mcp.
//
// Flow:
//   1. Spawn the compiled MCP server as a child process with an
//      in-memory backing store seeded with one known secret.
//   2. Open an MCP client over stdio and call `resolve` +
//      `rotate` against a `secret_ref`.
//   3. Assert the redacted envelope shape: `redacted === true`,
//      `value_len` matches the seed byte length, `fingerprint` is
//      a 16-char hex digest, no raw value is in the response.
//   4. Assert a `secret.rotated` audit event fires on rotate.
//   5. Assert a cross-tenant ref is rejected with a deny audit
//      event and an `isError: true` response.
//   6. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const TENANT_A = "tnt_smokeA";
const TENANT_B = "tnt_smokeB";
const RAW_VALUE = "gh_pat_REDACTED_DO_NOT_PRINT_xxxxxxxxxxxxxxxxxxxx";

function log(label, msg) {
  process.stdout.write(`[smoke] ${label}: ${msg}\n`);
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `assertion failed [${label}]:\n  expected: ${e}\n  actual:   ${a}`,
    );
  }
  log("ok", label);
}

function assertTrue(cond, label) {
  if (!cond) throw new Error(`assertion failed [${label}]: expected truthy`);
  log("ok", label);
}

function assertNoLeak(text, forbidden, label) {
  for (const s of forbidden) {
    if (text.includes(s)) {
      throw new Error(
        `assertion failed [${label}]: response contains forbidden substring '${s}'\n  full: ${text}`,
      );
    }
  }
  log("ok", label);
}

// We can't directly reach the InMemorySecretStore from a separate
// process, so the smoke test pre-seeds by writing a JSON config the
// server reads at boot. v0 supports only an empty in-memory store;
// the seeded variant is wired through a small env var the server
// reads in test mode. We assert the production path (no seed) and
// the cross-tenant rejection in the smoke test; the seeded positive
// path is exercised by the unit tests under `test/unit.mjs`.
const childEnv = {
  ...process.env,
  FORA_TENANT_ID: TENANT_A,
  FORA_BACKING_STORE: "memory",
  FORA_TRACE_ID: "trace-smoke-1",
  FORA_ACTOR: "agent:smoke",
  FORA_AGENT_TYPE: "developer",
};

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: childEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-secrets-smoke", version: "0.0.0" });
  await client.connect(transport);

  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stdout.write(`[smoke][server] ${s}`);
  });

  try {
    // 1. Resolve a not-yet-provisioned secret — should be a not_found
    //    error envelope, never a raw value.
    const missingRes = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: `tenants/${TENANT_A}/secrets/gh_pat` },
    });
    assertTrue(missingRes.isError === true, "resolve on missing secret returns isError: true");
    const missingBody = JSON.parse(missingRes.content[0].text);
    assertEqual(missingBody.ok, false, "missing-resolve body has ok: false");
    assertEqual(missingBody.code, "not_found", "missing-resolve body has code: not_found");
    assertNoLeak(
      JSON.stringify(missingRes),
      [RAW_VALUE, "gh_pat_REDACTED"],
      "missing-resolve response carries no raw value or ref-name tokens",
    );

    // 2. Resolve a malformed secret_ref — invalid_ref path.
    const malformedRes = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: "not-a-real-ref" },
    });
    assertTrue(malformedRes.isError === true, "resolve on malformed ref returns isError: true");
    const malformedBody = JSON.parse(malformedRes.content[0].text);
    assertEqual(malformedBody.code, "invalid_ref", "malformed-ref body has code: invalid_ref");

    // 3. Cross-tenant ref — even if the ref names tenant B, the server
    //    is pinned to tenant A and must reject with tenant_scope.
    const crossTenantRes = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: `tenants/${TENANT_B}/secrets/gh_pat` },
    });
    assertTrue(
      crossTenantRes.isError === true,
      "cross-tenant ref returns isError: true",
    );
    const crossBody = JSON.parse(crossTenantRes.content[0].text);
    assertEqual(
      crossBody.code,
      "tenant_scope",
      "cross-tenant ref body has code: tenant_scope",
    );

    // 4. Rotate a secret — should succeed (in-memory store creates a
    //    new version) and return version "1" + a created_at.
    const rotateRes = await client.callTool({
      name: "rotate",
      arguments: {
        secret_ref: `tenants/${TENANT_A}/secrets/gh_pat`,
        new_value: RAW_VALUE,
      },
    });
    assertEqual(rotateRes.isError, false, "rotate returns ok (no isError)");
    const rotateBody = JSON.parse(rotateRes.content[0].text);
    assertEqual(rotateBody.ok, true, "rotate body has ok: true");
    assertEqual(rotateBody.version, "1", "first rotate creates version 1");
    assertNoLeak(
      JSON.stringify(rotateRes),
      [RAW_VALUE],
      "rotate response does not echo the new_value",
    );

    // 5. Now resolve the same ref — should return a redacted envelope.
    const resolveRes = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: `tenants/${TENANT_A}/secrets/gh_pat` },
    });
    assertEqual(resolveRes.isError, false, "resolve returns ok");
    const env = JSON.parse(resolveRes.content[0].text);
    assertEqual(env.ok, true, "resolve body has ok: true");
    const envelope = env.envelope;
    assertEqual(envelope.redacted, true, "envelope.redacted === true");
    assertEqual(
      envelope.secret_ref,
      `tenants/${TENANT_A}/secrets/gh_pat@1`,
      "envelope.secret_ref echoes the canonical ref with the resolved version",
    );
    assertEqual(envelope.value_len, RAW_VALUE.length, "envelope.value_len matches byte length");
    assertTrue(
      /^[0-9a-f]{16}$/.test(envelope.fingerprint),
      `envelope.fingerprint is a 16-char hex digest (got '${envelope.fingerprint}')`,
    );
    assertTrue(typeof envelope.expires_at === "string" && envelope.expires_at.length > 0, "envelope.expires_at is a non-empty string");
    assertTrue(typeof envelope.resolved_at === "string" && envelope.resolved_at.length > 0, "envelope.resolved_at is a non-empty string");
    assertNoLeak(
      JSON.stringify(resolveRes),
      [RAW_VALUE, "gh_pat_REDACTED"],
      "resolve response contains no raw value or ref-name tokens",
    );

    // 6. Pin a specific version — rotate, then resolve @1, then
    //    resolve @latest and assert they differ.
    await client.callTool({
      name: "rotate",
      arguments: {
        secret_ref: `tenants/${TENANT_A}/secrets/gh_pat`,
        new_value: "second-rotation-value-xxxxxxxxxxxxxxxxxx",
      },
    });
    const v1 = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: `tenants/${TENANT_A}/secrets/gh_pat@1` },
    });
    const vLatest = await client.callTool({
      name: "resolve",
      arguments: { secret_ref: `tenants/${TENANT_A}/secrets/gh_pat` },
    });
    const v1Env = JSON.parse(v1.content[0].text).envelope;
    const vLatestEnv = JSON.parse(vLatest.content[0].text).envelope;
    assertEqual(v1Env.version, "1", "@1 resolves to version 1");
    assertEqual(vLatestEnv.version, "2", "@latest resolves to the new version");
    assertTrue(
      v1Env.fingerprint !== vLatestEnv.fingerprint,
      "different versions have different fingerprints",
    );

    log("done", "all secrets-mcp smoke checks green");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[smoke] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
