# `@fora/mcp-aws` — FORA AWS MCP Server

Priority-1 MCP server for the FORA Enterprise AI SDLC Operating System. Exposes seven read-only tools over MCP/stdio: `list_stacks`, `get_stack`, `list_stack_resources`, `get_resource`, `list_change_sets`, `get_change_set`, `describe_change_set`.

The server is **pinned to a single AWS account and a single region** at startup. The model can pass resource IDs (stack names, change-set names, type names) but the underlying account and region are server-pinned for safety. A `STS:GetCallerIdentity` round-trip on boot verifies that the resolved credential chain belongs to the pinned account; if it does not, the server refuses to start.

**Mutations are intentionally out of scope in v1.** `execute_change_set` and any Cloud Control write tools will land in a tracked follow-up to [FORA-92](/FORA/issues/FORA-92) behind a `confirm: true` Zod argument.

---

## Install

### From the monorepo (dev)

```bash
cd mcp-servers/aws
npm install
npm run build
```

The compiled entry point is `dist/index.js`. The launcher at `bin/fora-mcp-aws.mjs` resolves it for you.

### Pack and install (CI / design-partner handoff)

```bash
cd mcp-servers/aws
npm pack          # produces fora-mcp-aws-0.1.0.tgz
npm install -g ./fora-mcp-aws-0.1.0.tgz
```

After global install, `fora-mcp-aws` is on `PATH`.

### Wire into Paperclip

In your Paperclip MCP client config, add:

```jsonc
{
  "mcpServers": {
    "aws": {
      "command": "fora-mcp-aws",
      "env": {
        "AWS_REGION": "us-east-1",
        "AWS_ACCOUNT_ID": "123456789012",
        "AWS_PROFILE": "fora-customer-role"
      }
    }
  }
}
```

The server reads `AWS_REGION` and `AWS_ACCOUNT_ID` on startup. If either is missing, it exits with a non-zero status and a clear message naming the offending variable. Credentials are resolved from the standard AWS SDK chain (env → shared config → `AWS_PROFILE` → web identity → IAM role); the chain is **not** injected via Paperclip.

---

## Authentication

The server delegates credential resolution to the AWS SDK v3 chain. Pick the path that matches how you manage customer credentials.

### Option A — IAM role (recommended for production)

1. Create a single IAM role in the customer account with the least-privilege policy below.
2. Trust the principal that will run the MCP server (EC2 instance profile, ECS task role, GitHub Actions OIDC, etc.).
3. Set `AWS_REGION` and `AWS_ACCOUNT_ID` to the customer's region and 12-digit account id.
4. Leave `AWS_PROFILE` unset — the SDK picks up the role automatically.

### Option B — Named profile (simplest for dev)

1. `aws configure --profile fora-customer-role` and enter an access key, secret, and region.
2. Set `AWS_PROFILE=fora-customer-role` in the MCP client config.
3. Set `AWS_REGION` and `AWS_ACCOUNT_ID` to match.

### Option C — Long-lived access keys (avoid in production)

Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the MCP client env. The smoke test uses this path against a local mock.

### Least-privilege IAM policy

The minimum surface this server exercises is read-only CloudFormation, read-only Cloud Control, and a single `sts:GetCallerIdentity` call at boot. Drop the `cloudformation:*` action wildcards once you have audited the exact actions the read tools call (the smoke test asserts the wire operations).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BootVerification",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    },
    {
      "Sid": "CloudFormationRead",
      "Effect": "Allow",
      "Action": [
        "cloudformation:ListStacks",
        "cloudformation:DescribeStacks",
        "cloudformation:ListStackResources",
        "cloudformation:ListChangeSets",
        "cloudformation:DescribeChangeSet"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudControlRead",
      "Effect": "Allow",
      "Action": [
        "cloudcontrol:GetResource",
        "cloudcontrol:ListResources"
      ],
      "Resource": "*"
    }
  ]
}
```

> **Why account+region-pinned, not user-pinned?** A broader-scoped role would let a confused or malicious agent prompt call resources across the entire account. Pinning the account+region in the MCP client config + verifying via `STS:GetCallerIdentity` on boot is a hard security boundary that the server enforces on every call.

---

## Tools

All tools take resource IDs as arguments. The account and region are **not** tool inputs — they are server-pinned and asserted on every call via the SDK's region routing and the boot-time STS check.

| Tool | Purpose | Required args | Optional args |
| --- | --- | --- | --- |
| `list_stacks` | List CloudFormation stacks in the pinned account+region. | — | `status_filter` (array of statuses), `next_token` |
| `get_stack` | Get one stack by name, including parameters, outputs, capabilities. | `stackName` | — |
| `list_stack_resources` | List resources managed by a stack. | `stackName` | `next_token` |
| `get_resource` | Get a single resource via the Cloud Control API. | `type_name`, `identifier` | — |
| `list_change_sets` | List change sets for a stack. | `stackName` | `next_token` |
| `get_change_set` | Get a change set, including the changes it would apply. | `stackName`, `changeSetName` | — |
| `describe_change_set` | Describe a change set in detail (includes nested-stack linkage). | `stackName`, `changeSetName` | — |

### Example payloads

`list_stacks`:

```json
{
  "status_filter": ["CREATE_COMPLETE", "UPDATE_COMPLETE"]
}
```

`get_stack`:

```json
{ "stackName": "forge-network" }
```

`get_resource` (Cloud Control):

```json
{
  "type_name": "AWS::S3::Bucket",
  "identifier": "acme-artifacts"
}
```

`describe_change_set`:

```json
{
  "stackName": "forge-app",
  "changeSetName": "bump-image"
}
```

The model never passes `accountId` or `region` — they are server-pinned. Any attempt by a tool to surface a different account/region (e.g. a Cloud Control response that echoes a different `TypeName`) is rejected before it reaches the model.

---

## Run the smoke test

The smoke test boots a mock AWS HTTP server that speaks the AWS JSON 1.1 protocol, spawns the MCP server pointed at it, and exercises all 7 tools over stdio. It runs without any real AWS credentials.

```bash
cd mcp-servers/aws
npm run build
npm run smoke
```

Expected output ends with:

```
[smoke] done: all 7 tools smoke-tested green
```

If any assertion fails, the script exits non-zero and prints the failure. No real AWS account is touched.

The smoke also asserts:

- The `STS:GetCallerIdentity` boot check fires (and the mock's `Account` field matches the pinned `AWS_ACCOUNT_ID`).
- Every CloudFormation + Cloud Control tool calls the expected `X-Amz-Target` operation.
- A missing `AWS_ACCOUNT_ID` makes the server exit non-zero with a clear error message.

### Live smoke (against a real account)

A live smoke is **out of scope for this ticket** per the original FORA-92 description. The planned pattern (per the FORA-11 live-smoke model) is: run the smoke against a sandbox AWS account, then exercise every tool against that account with read-only IAM credentials.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits with `Invalid AWS MCP configuration: AWS_ACCOUNT_ID: ... must be exactly 12 digits` | `AWS_ACCOUNT_ID` missing or malformed | Set `AWS_ACCOUNT_ID` to the 12-digit customer account id. |
| Server exits with `AWS credential verification failed: ...` | The resolved credential chain does not match the pinned account | Check `AWS_PROFILE`, the IAM role trust policy, or web identity config. The server pinned `AWS_ACCOUNT_ID=...` but STS returned a different account. |
| `AccountScopeError: Refusing to act on account '...' — this server is pinned to '...'` | A `STS:GetCallerIdentity` round-trip returned a different account than the pinned one | Re-check `AWS_ACCOUNT_ID` against the role's actual account. |
| `AwsApiError: AWS CloudControl GetResource failed: ...` on `get_resource` | The resource type/identifier is wrong, or the IAM role lacks `cloudcontrol:GetResource` for that type | Verify the type/identifier pair against the AWS docs; add the action to the IAM policy if it is in scope. |
| `MCP error -32000: Connection closed` on first call | The child process died at startup (config error or missing `dist/`) | Check stderr — usually a missing env var or a failed `npm run build`. |
| Smoke test fails with `ECONNREFUSED 127.0.0.1:<port>` | The mock server failed to start | Inspect the smoke transcript; the mock server is spawned in the same script, so this is almost always a port conflict. |
| Tool returns `Error: Unknown tool: execute_change_set` | Mutations are out of scope in v1 | The model is asking for a destructive action that lives in the follow-up ticket. If the request is legitimate, schedule the follow-up. |

---

## Reuse: the FORA MCP server template

See `docs/template-note.md` for the contract drifts `@fora/mcp-aws` introduces vs. the `@fora/mcp-github` template, and the seven contract points the AWS package preserves verbatim.

---

## Out of scope (tracked elsewhere)

- **Live E2E against a real AWS account** — separate ticket, follows the FORA-11 live-smoke pattern with a sandbox account.
- **`execute_change_set` and other mutations** — separate ticket, ships with a `confirm: true` Zod argument per the FORA-92 contract note.
- **AWS Transform orchestration** — owned by the Refactor agent (Epic 8, [FORA-24](/FORA/issues/FORA-24)), not this MCP.
- **Bedrock / model invocation calls** — the platform model is Anthropic, not hosted on AWS Bedrock for v1.
