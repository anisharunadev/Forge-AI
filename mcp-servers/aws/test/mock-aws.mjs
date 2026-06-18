// test/mock-aws.mjs
// Lightweight in-memory AWS mock for the smoke test.
//
// Speaks the two protocols the FORA AWS MCP server's SDK actually uses:
//   - AWS query protocol (STS, CloudFormation in @aws-sdk/* 3.658.x):
//       POST /  Content-Type: application/x-www-form-urlencoded
//       Body: Action=...&Version=...&Other.member.1=...&NextToken=...
//       Response: text/xml wrapped in a <OperationResponse> envelope.
//   - AWS JSON 1.1 (Cloud Control):
//       POST /  Content-Type: application/x-amz-json-1.1
//       Header X-Amz-Target: CloudApiService.GetResource
//       Body / response: JSON.
//
// Records every call so the smoke test can assert on the wire operations
// the MCP server actually issued.

import http from "node:http";

/**
 * @typedef {Object} MockState
 * @property {string} pinnedAccountId
 * @property {string} pinnedRegion
 * @property {Array<Record<string, unknown>>} stacks
 * @property {Record<string, Array<Record<string, unknown>>>} stackResources
 * @property {Record<string, Array<Record<string, unknown>>>} changeSets
 * @property {Array<{ operation: string, protocol: string, body: unknown, headers: Record<string,string> }>} callLog
 */

/** @returns {MockState} */
export function initialState({ pinnedAccountId = "123456789012", pinnedRegion = "us-east-1" } = {}) {
  return {
    pinnedAccountId,
    pinnedRegion,
    stacks: [
      {
        StackName: "forge-network",
        StackId: `arn:aws:cloudformation:us-east-1:${pinnedAccountId}:stack/forge-network/aabbccdd`,
        StackStatus: "CREATE_COMPLETE",
        CreationTime: "2026-05-01T12:00:00.000Z",
        TemplateDescription: "VPC + subnets for the forge stack",
      },
      {
        StackName: "forge-app",
        StackId: `arn:aws:cloudformation:us-east-1:${pinnedAccountId}:stack/forge-app/eeff0011`,
        StackStatus: "UPDATE_COMPLETE",
        CreationTime: "2026-05-02T08:00:00.000Z",
        Description: "Application tier",
      },
    ],
    stackResources: {
      "forge-network": [
        {
          LogicalResourceId: "Vpc",
          PhysicalResourceId: "vpc-0a0b0c0d0e0f00000",
          ResourceType: "AWS::EC2::VPC",
          ResourceStatus: "CREATE_COMPLETE",
          Timestamp: "2026-05-01T12:05:00.000Z",
        },
        {
          LogicalResourceId: "PublicSubnet1",
          PhysicalResourceId: "subnet-0123456789abcdef0",
          ResourceType: "AWS::EC2::Subnet",
          ResourceStatus: "CREATE_COMPLETE",
          Timestamp: "2026-05-01T12:06:00.000Z",
        },
      ],
    },
    changeSets: {
      "forge-app": [
        {
          ChangeSetName: "bump-image",
          ChangeSetId: `arn:aws:cloudformation:us-east-1:${pinnedAccountId}:changeSet/forge-app/bump-image/11111111-2222-3333-4444-555555555555`,
          StackName: "forge-app",
          StackId: `arn:aws:cloudformation:us-east-1:${pinnedAccountId}:stack/forge-app/eeff0011`,
          Status: "CREATE_COMPLETE",
          ExecutionStatus: "AVAILABLE",
          CreationTime: "2026-06-10T09:30:00.000Z",
          Description: "Bump container image to v0.4.2",
          Changes: [
            {
              Type: "Resource",
              ResourceChange: {
                Action: "Modify",
                LogicalResourceId: "AppService",
                PhysicalResourceId: "forge-app-AppService-ABCDEFG",
                ResourceType: "AWS::ECS::Service",
                Replacement: "False",
              },
            },
          ],
        },
      ],
    },
    callLog: [],
  };
}

/**
 * @param {MockState} state
 * @param {number} port
 * @returns {Promise<{ baseUrl: string, shutdown: () => Promise<void>, port: number }>}
 */
export function startMockServer(state, port = 0) {
  return new Promise((resolveServer, rejectServer) => {
    const server = http.createServer((req, res) => {
      handleRequest(state, req, res);
    });
    server.on("error", rejectServer);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        rejectServer(new Error("mock server failed to bind"));
        return;
      }
      const boundPort = address.port;
      const baseUrl = `http://127.0.0.1:${boundPort}`;
      resolveServer({
        baseUrl,
        port: boundPort,
        shutdown: () =>
          new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

function handleRequest(state, req, res) {
  if (req.method !== "POST") {
    sendQueryError(res, 405, "MethodNotAllowed", "Only POST is accepted");
    return;
  }

  const contentType = String(req.headers["content-type"] || "");
  const target = String(req.headers["x-amz-target"] || "");
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const isQuery = contentType.startsWith("application/x-www-form-urlencoded");
    const protocol = isQuery ? "query" : "json";
    const parsed = parseRequestBody(raw, contentType);

    // The "operation" is what the smoke test asserts on. For query
    // protocol, it is the `Action` form value. For JSON 1.1, it is the
    // `X-Amz-Target` header.
    const operation = isQuery ? (parsed.Action || "") : target;

    state.callLog.push({
      operation,
      protocol,
      body: parsed,
      headers: {
        "x-amz-target": target,
        "content-type": contentType,
      },
    });

    try {
      if (isQuery) {
        dispatchQuery(state, operation, parsed, res);
      } else {
        dispatchJson(state, target, parsed, res);
      }
    } catch (err) {
      if (isQuery) {
        sendQueryError(res, 500, "InternalError", err.message);
      } else {
        sendJsonError(res, 500, "InternalError", err.message);
      }
    }
  });
}

function parseRequestBody(raw, contentType) {
  if (!raw) return {};
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Body was not valid JSON: ${err.message}`);
  }
}

function collectListParam(body, name) {
  // JSON 1.1: real array on body[name].
  if (Array.isArray(body[name])) return body[name];
  // Query protocol: name.member.1, name.member.2, ...
  const values = [];
  for (const k of Object.keys(body)) {
    if (k === name || k.startsWith(`${name}.member.`)) {
      values.push(body[k]);
    }
  }
  return values;
}

function getSingleParam(body, name) {
  // Query protocol sometimes sends top-level scalar fields directly.
  // JSON 1.1 sends them on the parsed object as scalars.
  return body[name];
}

function dispatchQuery(state, action, body, res) {
  switch (action) {
    case "ListStacks":
      return opListStacks(state, body, res);
    case "DescribeStacks":
      return opDescribeStacks(state, body, res);
    case "ListStackResources":
      return opListStackResources(state, body, res);
    case "ListChangeSets":
      return opListChangeSets(state, body, res);
    case "DescribeChangeSet":
      return opDescribeChangeSet(state, body, res);
    case "GetCallerIdentity":
      return opGetCallerIdentity(state, body, res);
    default:
      sendQueryError(res, 400, "InvalidAction", `Unmocked AWS query Action: ${action}`);
  }
}

function dispatchJson(state, target, body, res) {
  switch (target) {
    case "CloudApiService.GetResource":
      return opGetResource(state, body, res);
    default:
      sendJsonError(res, 400, "UnknownOperation", `Unmocked X-Amz-Target: ${target}`);
  }
}

// --- Operation handlers ----------------------------------------------------

function opListStacks(state, body, res) {
  const filter = collectListParam(body, "StackStatusFilter");
  const out = filter.length > 0
    ? state.stacks.filter((s) => filter.includes(s.StackStatus))
    : state.stacks;
  const nextToken = getSingleParam(body, "NextToken") || undefined;
  const members = out.map(stackSummaryToXml).join("");
  const xml =
    `<ListStacksResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<ListStacksResult>` +
    `<StackSummaries>${members}</StackSummaries>` +
    (nextToken ? `<NextToken>${esc(nextToken)}</NextToken>` : "") +
    `</ListStacksResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</ListStacksResponse>`;
  sendQueryXml(res, 200, xml);
}

function opDescribeStacks(state, body, res) {
  const name = getSingleParam(body, "StackName");
  if (!name) {
    sendQueryError(res, 400, "ValidationError", "StackName is required");
    return;
  }
  const stack = state.stacks.find((s) => s.StackName === name);
  if (!stack) {
    sendQueryError(res, 400, "ValidationError", `Stack ${name} does not exist`);
    return;
  }
  const detail = {
    ...stack,
    Parameters: [{ ParameterKey: "ImageTag", ParameterValue: "v0.4.1" }],
    Outputs: [
      {
        OutputKey: "VpcId",
        OutputValue: stack.StackName === "forge-network" ? "vpc-0a0b0c0d0e0f00000" : "vpc-shared",
        Description: "VPC id",
        ExportName: `${stack.StackName}-VpcId`,
      },
    ],
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    LastUpdatedTime: "2026-06-10T09:30:00.000Z",
  };
  const xml =
    `<DescribeStacksResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<DescribeStacksResult><Stacks>${stackDetailToXml(detail)}</Stacks></DescribeStacksResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</DescribeStacksResponse>`;
  sendQueryXml(res, 200, xml);
}

function opListStackResources(state, body, res) {
  const name = getSingleParam(body, "StackName");
  const resources = state.stackResources[name];
  if (!resources) {
    sendQueryError(res, 400, "ValidationError", `Stack ${name} has no recorded resources`);
    return;
  }
  const nextToken = getSingleParam(body, "NextToken") || undefined;
  const members = resources.map(stackResourceToXml).join("");
  const xml =
    `<ListStackResourcesResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<ListStackResourcesResult>` +
    `<StackResourceSummaries>${members}</StackResourceSummaries>` +
    (nextToken ? `<NextToken>${esc(nextToken)}</NextToken>` : "") +
    `</ListStackResourcesResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</ListStackResourcesResponse>`;
  sendQueryXml(res, 200, xml);
}

function opListChangeSets(state, body, res) {
  const name = getSingleParam(body, "StackName");
  const summaries = state.changeSets[name] ?? [];
  const nextToken = getSingleParam(body, "NextToken") || undefined;
  const members = summaries
    .map((cs) => ({
      ChangeSetName: cs.ChangeSetName,
      ChangeSetId: cs.ChangeSetId,
      StackName: cs.StackName,
      StackId: cs.StackId,
      Status: cs.Status,
      CreationTime: cs.CreationTime,
      Description: cs.Description,
    }))
    .map(changeSetSummaryToXml)
    .join("");
  const xml =
    `<ListChangeSetsResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<ListChangeSetsResult>` +
    `<Summaries>${members}</Summaries>` +
    (nextToken ? `<NextToken>${esc(nextToken)}</NextToken>` : "") +
    `</ListChangeSetsResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</ListChangeSetsResponse>`;
  sendQueryXml(res, 200, xml);
}

function opDescribeChangeSet(state, body, res) {
  const stackName = getSingleParam(body, "StackName");
  const changeSetName = getSingleParam(body, "ChangeSetName");
  const list = state.changeSets[stackName] ?? [];
  const cs = list.find((x) => x.ChangeSetName === changeSetName);
  if (!cs) {
    sendQueryError(res, 400, "ValidationError", `Change set ${changeSetName} not found in stack ${stackName}`);
    return;
  }
  const includePropertyValues = getSingleParam(body, "IncludePropertyValues");
  const includeNestedStacks = includePropertyValues === "true" ? "false" : undefined;
  const xml =
    `<DescribeChangeSetResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<DescribeChangeSetResult>` +
    changeSetDetailToXml(cs, { includeNestedStacks }) +
    `</DescribeChangeSetResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</DescribeChangeSetResponse>`;
  sendQueryXml(res, 200, xml);
}

function opGetResource(state, body, res) {
  const { TypeName, Identifier } = body;
  if (TypeName === "AWS::S3::Bucket" && Identifier === "acme-artifacts") {
    sendJsonOk(res, 200, {
      TypeName,
      ResourceDescription: {
        Identifier,
        Properties: JSON.stringify({ BucketName: Identifier, VersioningConfiguration: { Status: "Enabled" } }),
      },
    });
    return;
  }
  sendJsonError(res, 400, "ResourceNotFoundException", `No ${TypeName} with identifier ${Identifier}`);
}

function opGetCallerIdentity(state, _body, res) {
  const xml =
    `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">` +
    `<GetCallerIdentityResult>` +
    `<UserId>AROAEXAMPLE:session</UserId>` +
    `<Account>${state.pinnedAccountId}</Account>` +
    `<Arn>arn:aws:iam::${state.pinnedAccountId}:role/fora-mcp-aws</Arn>` +
    `</GetCallerIdentityResult>` +
    `<ResponseMetadata><RequestId>mock-request-id</RequestId></ResponseMetadata>` +
    `</GetCallerIdentityResponse>`;
  sendQueryXml(res, 200, xml);
}

// --- XML serializers -------------------------------------------------------

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stackSummaryToXml(s) {
  return (
    `<member>` +
    `<StackName>${esc(s.StackName)}</StackName>` +
    `<StackId>${esc(s.StackId)}</StackId>` +
    `<StackStatus>${esc(s.StackStatus)}</StackStatus>` +
    `<CreationTime>${esc(s.CreationTime)}</CreationTime>` +
    (s.TemplateDescription ? `<TemplateDescription>${esc(s.TemplateDescription)}</TemplateDescription>` : "") +
    (s.Description ? `<Description>${esc(s.Description)}</Description>` : "") +
    `</member>`
  );
}

function stackDetailToXml(s) {
  const parameters = (s.Parameters || [])
    .map((p) => `<member><ParameterKey>${esc(p.ParameterKey)}</ParameterKey><ParameterValue>${esc(p.ParameterValue)}</ParameterValue></member>`)
    .join("");
  const outputs = (s.Outputs || [])
    .map(
      (o) =>
        `<member><OutputKey>${esc(o.OutputKey)}</OutputKey><OutputValue>${esc(o.OutputValue)}</OutputValue>` +
        (o.Description ? `<Description>${esc(o.Description)}</Description>` : "") +
        (o.ExportName ? `<ExportName>${esc(o.ExportName)}</ExportName>` : "") +
        `</member>`,
    )
    .join("");
  const capabilities = (s.Capabilities || []).map((c) => `<member>${esc(c)}</member>`).join("");
  return (
    `<member>` +
    `<StackName>${esc(s.StackName)}</StackName>` +
    `<StackId>${esc(s.StackId)}</StackId>` +
    `<StackStatus>${esc(s.StackStatus)}</StackStatus>` +
    `<CreationTime>${esc(s.CreationTime)}</CreationTime>` +
    (s.TemplateDescription ? `<TemplateDescription>${esc(s.TemplateDescription)}</TemplateDescription>` : "") +
    (s.Description ? `<Description>${esc(s.Description)}</Description>` : "") +
    `<Parameters>${parameters}</Parameters>` +
    `<Outputs>${outputs}</Outputs>` +
    `<Capabilities>${capabilities}</Capabilities>` +
    (s.LastUpdatedTime ? `<LastUpdatedTime>${esc(s.LastUpdatedTime)}</LastUpdatedTime>` : "") +
    `</member>`
  );
}

function stackResourceToXml(r) {
  return (
    `<member>` +
    `<LogicalResourceId>${esc(r.LogicalResourceId)}</LogicalResourceId>` +
    (r.PhysicalResourceId ? `<PhysicalResourceId>${esc(r.PhysicalResourceId)}</PhysicalResourceId>` : "") +
    `<ResourceType>${esc(r.ResourceType)}</ResourceType>` +
    `<ResourceStatus>${esc(r.ResourceStatus)}</ResourceStatus>` +
    `<Timestamp>${esc(r.Timestamp)}</Timestamp>` +
    (r.ResourceStatusReason ? `<ResourceStatusReason>${esc(r.ResourceStatusReason)}</ResourceStatusReason>` : "") +
    `</member>`
  );
}

function changeSetSummaryToXml(cs) {
  return (
    `<member>` +
    `<ChangeSetName>${esc(cs.ChangeSetName)}</ChangeSetName>` +
    `<ChangeSetId>${esc(cs.ChangeSetId)}</ChangeSetId>` +
    `<StackName>${esc(cs.StackName)}</StackName>` +
    `<StackId>${esc(cs.StackId)}</StackId>` +
    `<Status>${esc(cs.Status)}</Status>` +
    `<CreationTime>${esc(cs.CreationTime)}</CreationTime>` +
    (cs.Description ? `<Description>${esc(cs.Description)}</Description>` : "") +
    `</member>`
  );
}

function changeSetDetailToXml(cs, opts = {}) {
  const changes = (cs.Changes || [])
    .map((c) => {
      const rc = c.ResourceChange;
      return (
        `<member>` +
        `<Type>${esc(c.Type)}</Type>` +
        (rc
          ? `<ResourceChange>` +
            `<Action>${esc(rc.Action)}</Action>` +
            `<LogicalResourceId>${esc(rc.LogicalResourceId)}</LogicalResourceId>` +
            (rc.PhysicalResourceId ? `<PhysicalResourceId>${esc(rc.PhysicalResourceId)}</PhysicalResourceId>` : "") +
            `<ResourceType>${esc(rc.ResourceType)}</ResourceType>` +
            (rc.Replacement ? `<Replacement>${esc(rc.Replacement)}</Replacement>` : "") +
            `</ResourceChange>`
          : "") +
        `</member>`
      );
    })
    .join("");
  return (
    `<ChangeSetName>${esc(cs.ChangeSetName)}</ChangeSetName>` +
    `<ChangeSetId>${esc(cs.ChangeSetId)}</ChangeSetId>` +
    `<StackName>${esc(cs.StackName)}</StackName>` +
    `<StackId>${esc(cs.StackId)}</StackId>` +
    `<Status>${esc(cs.Status)}</Status>` +
    `<ExecutionStatus>${esc(cs.ExecutionStatus)}</ExecutionStatus>` +
    (cs.StatusReason ? `<StatusReason>${esc(cs.StatusReason)}</StatusReason>` : "") +
    `<CreationTime>${esc(cs.CreationTime)}</CreationTime>` +
    (cs.Description ? `<Description>${esc(cs.Description)}</Description>` : "") +
    (opts.includeNestedStacks ? `<IncludeNestedStacks>${opts.includeNestedStacks}</IncludeNestedStacks>` : "") +
    `<Changes>${changes}</Changes>`
  );
}

// --- Wire response helpers -------------------------------------------------

function sendQueryXml(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendQueryError(res, status, code, message) {
  // AWS query protocol errors are XML, not JSON.
  const xml =
    `<ErrorResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/">` +
    `<Error><Type>Sender</Type><Code>${esc(code)}</Code><Message>${esc(message)}</Message></Error>` +
    `<RequestId>mock-request-id</RequestId>` +
    `</ErrorResponse>`;
  res.writeHead(status, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(xml),
  });
  res.end(xml);
}

function sendJsonOk(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/x-amz-json-1.1",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendJsonError(res, status, code, message) {
  const body = JSON.stringify({ __type: code, message });
  res.writeHead(status, {
    "Content-Type": "application/x-amz-json-1.1",
    "x-amzn-ErrorType": code,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
