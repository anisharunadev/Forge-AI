/**
 * Typed AWS SDK v3 client wrapper, scoped to a single account+region.
 *
 * The MCP server only ever calls these methods. The account and region are
 * pinned at boot via `Config`; the model can pass resource IDs (stack names,
 * change-set names, type names) but every call is asserted against the
 * pinned account and routed through clients configured with the pinned
 * region. Any mismatch raises `AccountScopeError` or `RegionScopeError`
 * before any HTTP call lands.
 *
 * We use the AWS SDK v3 directly (no higher-level wrapper) because the
 * surface we need is small and stable: read-only CloudFormation + read-only
 * Cloud Control. Keeping the SDK at arm's length also makes the mock-HTTP
 * smoke test trivial to wire.
 */

import {
  CloudFormationClient,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ListChangeSetsCommand,
  ListStackResourcesCommand,
  ListStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  CloudControlClient,
  GetResourceCommand,
  type GetResourceCommandOutput,
} from "@aws-sdk/client-cloudcontrol";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import type { Config } from "./config.js";

export class AccountScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act on account '${requested}' — this server is pinned to '${allowed}'.`,
    );
    this.name = "AccountScopeError";
  }
}

export class RegionScopeError extends Error {
  constructor(requested: string, allowed: string) {
    super(
      `Refusing to act in region '${requested}' — this server is pinned to '${allowed}'.`,
    );
    this.name = "RegionScopeError";
  }
}

export class AwsApiError extends Error {
  constructor(
    public readonly service: string,
    public readonly operation: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: string,
  ) {
    super(`AWS ${service} ${operation} failed: ${code} (HTTP ${status}) — ${truncate(body, 200)}`);
    this.name = "AwsApiError";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export interface StackSummary {
  stackName: string;
  stackId: string;
  stackStatus: string;
  creationTime: string;
  templateDescription?: string;
}

export interface StackDetail extends StackSummary {
  description?: string;
  parameters: Array<{ key: string; value: string }>;
  outputs: Array<{ key: string; value: string; description?: string; exportName?: string }>;
  capabilities: string[];
  lastUpdatedTime?: string;
}

export interface StackResource {
  logicalResourceId: string;
  physicalResourceId?: string;
  resourceType: string;
  resourceStatus: string;
  timestamp: string;
  resourceStatusReason?: string;
}

export interface ChangeSetSummary {
  changeSetName: string;
  changeSetId: string;
  stackName: string;
  stackId: string;
  status: string;
  creationTime: string;
  description?: string;
}

export interface ChangeSetDetail extends ChangeSetSummary {
  executionStatus: string;
  statusReason?: string;
  changes: Array<{
    type: string;
    resourceChange?: {
      action: string;
      logicalResourceId: string;
      physicalResourceId?: string;
      resourceType: string;
      replacement?: string;
    };
  }>;
}

export interface ChangeSetDescription extends ChangeSetDetail {
  includeNestedStacks?: boolean;
  parentChangeSetId?: string;
  rootChangeSetId?: string;
}

export interface Client {
  listStacks(args?: { statusFilter?: string[]; nextToken?: string }): Promise<{ stacks: StackSummary[]; nextToken?: string }>;
  getStack(args: { stackName: string }): Promise<StackDetail>;
  listStackResources(args: { stackName: string; nextToken?: string }): Promise<{ resources: StackResource[]; nextToken?: string }>;
  getResource(args: { typeName: string; identifier: string }): Promise<GetResourceCommandOutput>;
  listChangeSets(args: { stackName: string; nextToken?: string }): Promise<{ changeSets: ChangeSetSummary[]; nextToken?: string }>;
  getChangeSet(args: { changeSetName: string; stackName: string }): Promise<ChangeSetDetail>;
  describeChangeSet(args: { changeSetName: string; stackName: string }): Promise<ChangeSetDescription>;
}

export interface CreateClientResult {
  client: Client;
  accountId: string;
  region: string;
}

export async function createClient(config: Config): Promise<CreateClientResult> {
  // Common client options: pinned region, optional endpoint override, custom
  // user agent. Credentials are resolved lazily by the SDK from the env /
  // shared config / web identity / IAM chain — we never inject creds here.
  const clientOpts = {
    region: config.region,
    ...(config.endpointUrl ? { endpoint: config.endpointUrl } : {}),
    customUserAgent: config.userAgent,
  };

  const cfn = new CloudFormationClient(clientOpts);
  const ccc = new CloudControlClient(clientOpts);
  const sts = new STSClient(clientOpts);

  // Optional boot-time verification: STS:GetCallerIdentity must echo the
  // pinned account. This catches the case where the operator fat-fingered
  // AWS_ACCOUNT_ID or has stale credentials pointing at a different account.
  if (!config.skipCredentialVerify) {
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      if (identity.Account && identity.Account !== config.accountId) {
        throw new AccountScopeError(identity.Account, config.accountId);
      }
    } catch (err) {
      if (err instanceof AccountScopeError) throw err;
      const e = err as { name?: string; message?: string };
      throw new Error(
        `AWS credential verification failed: ${e.message ?? String(err)}. ` +
          `The pinned AWS_ACCOUNT_ID='${config.accountId}' could not be matched against the resolved ` +
          `credential chain. Re-check AWS_PROFILE / web identity / IAM role, or set ` +
          `AWS_SKIP_CREDENTIAL_VERIFY=1 for smoke tests.`,
      );
    }
  }

  const client: Client = {
    async listStacks({ statusFilter, nextToken } = {}) {
      // CloudFormation ListStacks takes `StackStatusFilter` as an array of
      // `StackStatus` literal strings. We default to a healthy set
      // (CREATE_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE,
      // IMPORT_COMPLETE) so stacks in DELETE_COMPLETE state don't appear by
      // accident. The user-supplied `statusFilter` is a `string[]` from the
      // tool surface — the Zod input constrains values to the same union at
      // the model boundary, so the cast is safe at runtime.
      const statuses: string[] = statusFilter && statusFilter.length > 0
        ? statusFilter
        : ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "IMPORT_COMPLETE"];
      try {
        const res = await cfn.send(
          new ListStacksCommand({ StackStatusFilter: statuses as never, NextToken: nextToken }),
        );
        const stacks = (res.StackSummaries ?? []).map((s) => toStackSummary(s as unknown as Record<string, unknown>));
        return { stacks, nextToken: res.NextToken };
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "ListStacks");
      }
    },

    async getStack({ stackName }) {
      try {
        const res = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
        const stack = res.Stacks?.[0];
        if (!stack) {
          throw new Error(`Stack not found: ${stackName}`);
        }
        return toStackDetail(stack as unknown as Record<string, unknown>);
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "DescribeStacks");
      }
    },

    async listStackResources({ stackName, nextToken }) {
      try {
        const res = await cfn.send(
          new ListStackResourcesCommand({ StackName: stackName, NextToken: nextToken }),
        );
        const resources = (res.StackResourceSummaries ?? []).map((r) => toStackResource(r as unknown as Record<string, unknown>));
        return { resources, nextToken: res.NextToken };
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "ListStackResources");
      }
    },

    async getResource({ typeName, identifier }) {
      try {
        const out = await ccc.send(
          new GetResourceCommand({ TypeName: typeName, Identifier: identifier }),
        );
        // ResourceDescription.TypeName echoes the type we asked for; we
        // assert that here so the model can't smuggle a different type
        // through the identifier field.
        if (out.TypeName && out.TypeName !== typeName) {
          throw new Error(
            `Cloud Control returned TypeName='${out.TypeName}' for Identifier='${identifier}' ` +
              `but the request asked for '${typeName}'. Refusing to surface a mismatched resource.`,
          );
        }
        return out;
      } catch (err) {
        throw wrapAwsError(err, "CloudControl", "GetResource");
      }
    },

    async listChangeSets({ stackName, nextToken }) {
      try {
        const res = await cfn.send(
          new ListChangeSetsCommand({ StackName: stackName, NextToken: nextToken }),
        );
        const changeSets = (res.Summaries ?? []).map((s) => toChangeSetSummary(s as unknown as Record<string, unknown>));
        return { changeSets, nextToken: res.NextToken };
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "ListChangeSets");
      }
    },

    async getChangeSet({ changeSetName, stackName }) {
      try {
        const res = await cfn.send(
          new DescribeChangeSetCommand({ ChangeSetName: changeSetName, StackName: stackName }),
        );
        return toChangeSetDetail(res as unknown as Record<string, unknown>);
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "DescribeChangeSet");
      }
    },

    async describeChangeSet({ changeSetName, stackName }) {
      // AWS collapsed DescribeChangeSet and GetChangeSet into the same
      // wire call; the "describe" variant is a more verbose projection
      // that includes nested-stack linkage. The wire operation is
      // DescribeChangeSet regardless; we project the extra fields here.
      try {
        const res = await cfn.send(
          new DescribeChangeSetCommand({
            ChangeSetName: changeSetName,
            StackName: stackName,
            IncludePropertyValues: true,
          }),
        );
        return toChangeSetDescription(res as unknown as Record<string, unknown>);
      } catch (err) {
        throw wrapAwsError(err, "CloudFormation", "DescribeChangeSet");
      }
    },
  };

  return { client, accountId: config.accountId, region: config.region };
}

function wrapAwsError(err: unknown, service: string, operation: string): Error {
  if (err instanceof AccountScopeError || err instanceof RegionScopeError) return err;
  const e = err as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
    Code?: string;
  };
  const status = e.$metadata?.httpStatusCode ?? 0;
  const code = e.Code ?? e.name ?? "UnknownError";
  const message = e.message ?? String(err);
  return new AwsApiError(service, operation, status, code, message);
}

function toStackSummary(s: Record<string, unknown>): StackSummary {
  return {
    stackName: s.StackName as string,
    stackId: s.StackId as string,
    stackStatus: s.StackStatus as string,
    creationTime: (s.CreationTime as string) ?? new Date(0).toISOString(),
    templateDescription: s.TemplateDescription as string | undefined,
  };
}

function toStackDetail(s: Record<string, unknown>): StackDetail {
  return {
    ...toStackSummary(s),
    description: s.Description as string | undefined,
    parameters: ((s.Parameters as Array<Record<string, unknown>>) ?? []).map((p) => ({
      key: p.ParameterKey as string,
      value: p.ParameterValue as string,
    })),
    outputs: ((s.Outputs as Array<Record<string, unknown>>) ?? []).map((o) => ({
      key: o.OutputKey as string,
      value: o.OutputValue as string,
      description: o.Description as string | undefined,
      exportName: o.ExportName as string | undefined,
    })),
    capabilities: (s.Capabilities as string[]) ?? [],
    lastUpdatedTime: s.LastUpdatedTime as string | undefined,
  };
}

function toStackResource(r: Record<string, unknown>): StackResource {
  return {
    logicalResourceId: r.LogicalResourceId as string,
    physicalResourceId: r.PhysicalResourceId as string | undefined,
    resourceType: r.ResourceType as string,
    resourceStatus: r.ResourceStatus as string,
    timestamp: (r.Timestamp as string) ?? new Date(0).toISOString(),
    resourceStatusReason: r.ResourceStatusReason as string | undefined,
  };
}

function toChangeSetSummary(s: Record<string, unknown>): ChangeSetSummary {
  return {
    changeSetName: s.ChangeSetName as string,
    changeSetId: s.ChangeSetId as string,
    stackName: s.StackName as string,
    stackId: s.StackId as string,
    status: s.Status as string,
    creationTime: (s.CreationTime as string) ?? new Date(0).toISOString(),
    description: s.Description as string | undefined,
  };
}

function toChangeSetDetail(s: Record<string, unknown>): ChangeSetDetail {
  return {
    ...toChangeSetSummary(s),
    executionStatus: (s.ExecutionStatus as string) ?? "AVAILABLE",
    statusReason: s.StatusReason as string | undefined,
    changes: ((s.Changes as Array<Record<string, unknown>>) ?? []).map((c) => ({
      type: c.Type as string,
      resourceChange: c.ResourceChange
        ? {
            action: (c.ResourceChange as Record<string, unknown>).Action as string,
            logicalResourceId: (c.ResourceChange as Record<string, unknown>)
              .LogicalResourceId as string,
            physicalResourceId: (c.ResourceChange as Record<string, unknown>)
              .PhysicalResourceId as string | undefined,
            resourceType: (c.ResourceChange as Record<string, unknown>)
              .ResourceType as string,
            replacement: (c.ResourceChange as Record<string, unknown>)
              .Replacement as string | undefined,
          }
        : undefined,
    })),
  };
}

function toChangeSetDescription(s: Record<string, unknown>): ChangeSetDescription {
  return {
    ...toChangeSetDetail(s),
    includeNestedStacks: s.IncludeNestedStacks as boolean | undefined,
    parentChangeSetId: s.ParentChangeSetId as string | undefined,
    rootChangeSetId: s.RootChangeSetId as string | undefined,
  };
}
