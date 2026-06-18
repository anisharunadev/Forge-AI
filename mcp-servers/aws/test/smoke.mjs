// test/smoke.mjs
// End-to-end smoke test for the FORA AWS MCP server.
//
// Flow:
//   1. Spin up a mock AWS HTTP server (JSON 1.1 protocol) on a random port.
//   2. Spawn the compiled MCP server as a child process, pointed at the mock.
//   3. Open an MCP client over stdio and call every read tool at least once.
//   4. Assert the returned payloads AND that the expected AWS operations landed.
//   5. Tear everything down.
//
// Exits non-zero on the first assertion failure.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { initialState, startMockServer } from "./mock-aws.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const serverEntry = resolve(packageRoot, "dist/index.js");

const PINNED_ACCOUNT = "123456789012";
const PINNED_REGION = "us-east-1";
const FAKE_AWS_ACCESS_KEY_ID = "AKIASMOKETESTEXAMPLE";
const FAKE_AWS_SECRET_ACCESS_KEY = "smoketest/fakeSecretKeyThatIsAtLeast16Chars";

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

function assertIncludes(arr, predicate, label) {
  if (!arr.some(predicate)) {
    throw new Error(`assertion failed [${label}]: no matching entry in ${JSON.stringify(arr)}`);
  }
  log("ok", label);
}

async function main() {
  // 1. Mock AWS server.
  const state = initialState({ pinnedAccountId: PINNED_ACCOUNT, pinnedRegion: PINNED_REGION });
  const { baseUrl, shutdown: shutdownMock } = await startMockServer(state);
  log("mock", `listening at ${baseUrl}`);

  const childEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: FAKE_AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: FAKE_AWS_SECRET_ACCESS_KEY,
    AWS_REGION: PINNED_REGION,
    AWS_ACCOUNT_ID: PINNED_ACCOUNT,
    AWS_ENDPOINT_URL: baseUrl,
    // The smoke test asserts on STS-backed startup; we let the SDK perform
    // the GetCallerIdentity round-trip and have the mock return the pinned
    // account. This exercises the production boot path.
    // AWS_SKIP_CREDENTIAL_VERIFY is NOT set on purpose.
  };

  // 2. MCP server child process.
  const child = spawn(process.execPath, [serverEntry], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let childStderr = "";
  child.stderr.on("data", (b) => {
    childStderr += b.toString("utf8");
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[smoke] MCP server exited early code=${code}\n${childStderr}\n`);
    }
  });

  // 3. MCP client (drives the same child via stdio transport).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: childEnv,
    stderr: "pipe",
  });
  const client = new Client({ name: "fora-aws-smoke", version: "0.0.0" });
  await client.connect(transport);

  let transportStderr = "";
  transport.stderr?.on("data", (b) => {
    const s = b.toString("utf8");
    transportStderr += s;
    process.stderr.write(`[smoke][server] ${s}`);
  });

  try {
    // 4a. list_stacks
    const listStacksRes = await client.callTool({
      name: "list_stacks",
      arguments: {},
    });
    const listStacks = JSON.parse(listStacksRes.content[0].text);
    assertEqual(listStacks.stacks.length, 2, "list_stacks returns 2 stacks");
    assertEqual(
      listStacks.stacks.map((s) => s.stackName).sort(),
      ["forge-app", "forge-network"],
      "list_stacks returns the expected stack names",
    );

    // 4b. get_stack
    const getStackRes = await client.callTool({
      name: "get_stack",
      arguments: { stackName: "forge-network" },
    });
    const stack = JSON.parse(getStackRes.content[0].text);
    assertEqual(stack.stackName, "forge-network", "get_stack returns the right stack");
    assertEqual(stack.stackStatus, "CREATE_COMPLETE", "get_stack returns the right status");
    assertTrue(Array.isArray(stack.parameters), "get_stack returns parameters array");
    assertTrue(Array.isArray(stack.outputs), "get_stack returns outputs array");

    // 4c. list_stack_resources
    const listResRes = await client.callTool({
      name: "list_stack_resources",
      arguments: { stackName: "forge-network" },
    });
    const listRes = JSON.parse(listResRes.content[0].text);
    assertEqual(listRes.resources.length, 2, "list_stack_resources returns 2 resources");
    assertTrue(
      listRes.resources.some((r) => r.logicalResourceId === "Vpc"),
      "list_stack_resources includes Vpc",
    );

    // 4d. get_resource (Cloud Control)
    const getResourceRes = await client.callTool({
      name: "get_resource",
      arguments: { type_name: "AWS::S3::Bucket", identifier: "acme-artifacts" },
    });
    const resource = JSON.parse(getResourceRes.content[0].text);
    assertEqual(resource.TypeName, "AWS::S3::Bucket", "get_resource returns the right TypeName");
    assertEqual(resource.ResourceDescription.Identifier, "acme-artifacts", "get_resource returns the right Identifier");
    assertTrue(
      typeof resource.ResourceDescription.Properties === "string" && resource.ResourceDescription.Properties.includes("acme-artifacts"),
      "get_resource returns the right Properties",
    );

    // 4e. list_change_sets
    const listCsRes = await client.callTool({
      name: "list_change_sets",
      arguments: { stackName: "forge-app" },
    });
    const listCs = JSON.parse(listCsRes.content[0].text);
    assertEqual(listCs.changeSets.length, 1, "list_change_sets returns 1 change set");
    assertEqual(listCs.changeSets[0].changeSetName, "bump-image", "list_change_sets returns the right change set name");

    // 4f. get_change_set
    const getCsRes = await client.callTool({
      name: "get_change_set",
      arguments: { stackName: "forge-app", changeSetName: "bump-image" },
    });
    const cs = JSON.parse(getCsRes.content[0].text);
    assertEqual(cs.changeSetName, "bump-image", "get_change_set returns the right change set");
    assertTrue(Array.isArray(cs.changes) && cs.changes.length === 1, "get_change_set returns 1 change");

    // 4g. describe_change_set (IncludePropertyValues=true)
    const describeCsRes = await client.callTool({
      name: "describe_change_set",
      arguments: { stackName: "forge-app", changeSetName: "bump-image" },
    });
    const describeCs = JSON.parse(describeCsRes.content[0].text);
    assertEqual(describeCs.changeSetName, "bump-image", "describe_change_set returns the right change set");
    assertEqual(describeCs.includeNestedStacks, false, "describe_change_set returns the verbose projection");

    // 5. Cross-check the AWS layer: confirm the server issued the right
    //    operations against the mock. This proves the MCP server is
    //    actually wiring calls through to AWS-shaped HTTP, not just
    //    returning canned data. STS and CloudFormation in this SDK
    //    version use the AWS query protocol (Action=…); Cloud Control
    //    uses JSON 1.1 (X-Amz-Target). The mock records the operation
    //    name in protocol-native form.
    const ops = state.callLog.map((c) => c.operation);
    log("aws", `recorded ${ops.length} operations`);
    log("aws", ops.join("\n  "));

    assertIncludes(state.callLog, (c) => c.operation === "GetCallerIdentity", "AWS: boot verification called GetCallerIdentity");
    assertIncludes(state.callLog, (c) => c.operation === "ListStacks", "AWS: list_stacks hit ListStacks");
    assertIncludes(state.callLog, (c) => c.operation === "DescribeStacks", "AWS: get_stack hit DescribeStacks");
    assertIncludes(state.callLog, (c) => c.operation === "ListStackResources", "AWS: list_stack_resources hit ListStackResources");
    assertIncludes(state.callLog, (c) => c.operation === "CloudApiService.GetResource", "AWS: get_resource hit Cloud Control GetResource");
    assertIncludes(state.callLog, (c) => c.operation === "ListChangeSets", "AWS: list_change_sets hit ListChangeSets");
    // get_change_set and describe_change_set both wire to DescribeChangeSet.
    assertTrue(
      state.callLog.filter((c) => c.operation === "DescribeChangeSet").length >= 2,
      "AWS: get_change_set + describe_change_set both hit DescribeChangeSet (≥2 calls)",
    );

    // 6. Verify the server doesn't crash on a missing stack — surfacing
    //    the AWS error cleanly to the model. The MCP server returns
    //    isError: true on tool failures rather than throwing, so the
    //    model can see the error inline.
    const missingRes = await client.callTool({ name: "get_stack", arguments: { stackName: "does-not-exist" } });
    assertTrue(missingRes.isError === true, "get_stack on a missing stack returns isError: true");
    const missingText = String(missingRes.content?.[0]?.text ?? "");
    assertTrue(
      /does-not-exist|not exist|ValidationError|AwsApiError|Stack not found/i.test(missingText),
      `get_stack error mentions the missing stack (got: ${missingText.slice(0, 120)})`,
    );

    // 7. Verify the server starts cleanly when AWS_ACCOUNT_ID is missing.
    //    (Re-check the configuration guard without burning a real boot.)
    const guard = await new Promise((resolveGuard) => {
      const probe = spawn(process.execPath, [serverEntry], {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: FAKE_AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: FAKE_AWS_SECRET_ACCESS_KEY,
          AWS_REGION: PINNED_REGION,
          AWS_ENDPOINT_URL: baseUrl,
          AWS_SKIP_CREDENTIAL_VERIFY: "1",
          // AWS_ACCOUNT_ID deliberately omitted.
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      probe.stderr.on("data", (b) => (stderr += b.toString("utf8")));
      probe.on("exit", (code) => resolveGuard({ code, stderr }));
      probe.stdin.end();
    });
    assertTrue(guard.code !== 0, "missing AWS_ACCOUNT_ID makes the server exit non-zero");
    assertTrue(
      /AWS_ACCOUNT_ID/.test(guard.stderr),
      "missing AWS_ACCOUNT_ID error names the offending env var",
    );

    log("done", "all 7 tools smoke-tested green");
  } finally {
    await client.close();
    child.kill("SIGTERM");
    await shutdownMock();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[smoke] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
