/**
 * Bridge configuration.
 *
 * All env-driven. Required:
 *   FORA_NATS_URL              — e.g. nats://nats.platform.svc:4222
 *   FORA_SNS_TOPIC_ARN         — the SNS topic the audit account's SQS subscribes to
 *   FORA_AWS_REGION            — e.g. us-east-1
 *
 * Optional:
 *   FORA_TENANT_ID             — single tenant the bridge serves (one instance per tenant)
 *   FORA_DURABLE_NAME          — durable consumer name (default: audit-bridge-<tenant>)
 *   FORA_MAX_MAJOR_VERSION     — schema major the bridge accepts (default: 1)
 *   FORA_RATE_RPS              — bridge consume rate (default: 200)
 */

export interface BridgeConfig {
  readonly natsUrl: string;
  readonly snsTopicArn: string;
  readonly awsRegion: string;
  readonly tenantId: string;
  readonly durableName: string;
  readonly maxMajorVersion: number;
  readonly rateRps: number;
}

function envOrFail(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`required env var missing: ${name}`);
  return v;
}

function envOr(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfigFromEnv(): BridgeConfig {
  const tenantId = envOr('FORA_TENANT_ID', '*');
  const durableName = envOr('FORA_DURABLE_NAME', `audit-bridge-${tenantId}`);
  return {
    natsUrl: envOrFail('FORA_NATS_URL'),
    snsTopicArn: envOrFail('FORA_SNS_TOPIC_ARN'),
    awsRegion: envOrFail('FORA_AWS_REGION'),
    tenantId,
    durableName,
    maxMajorVersion: Number(envOr('FORA_MAX_MAJOR_VERSION', '1')),
    rateRps: Number(envOr('FORA_RATE_RPS', '200')),
  };
}
