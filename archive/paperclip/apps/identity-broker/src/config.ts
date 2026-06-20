/**
 * Configuration loader for the identity-broker.
 *
 * In v1 the config is read from environment variables. Production should
 * source the JSON from a secrets manager; this module is the seam.
 *
 * Env vars:
 *   IDENTITY_BROKER_LISTEN_HOST  default 0.0.0.0
 *   IDENTITY_BROKER_LISTEN_PORT  default 8080
 *   IDENTITY_BROKER_PUBLIC_URL   the public base URL of the broker
 *                                (used to build redirect URIs and the
 *                                OIDC `iss` for FORA-issued tokens)
 *   IDENTITY_BROKER_TENANT_CONFIG  path to tenant_id → OidcClientConfig JSON
 *                                  file. Each tenant is a JSON object with
 *                                  keys: idp_id, kind, issuer, client_id,
 *                                  client_secret, redirect_uri.
 *                                  Tenants without a `webhook_secret` opt out
 *                                  of the IdP revocation webhook (the
 *                                  /auth/idp-revoke endpoint returns 404 for
 *                                  them).
 *   IDENTITY_BROKER_TENANT_WEBHOOK_SECRETS  optional JSON object
 *                                  {tenant_id: shared_secret}. Loaded
 *                                  alongside TENANT_CONFIG so the broker can
 *                                  verify X-IdP-Signature: sha256=<hex> on
 *                                  inbound revocation webhooks. NEVER logged.
 *   IDENTITY_BROKER_SIGNING_KEY  ES256 JWK (private). If absent, an ephemeral
 *                                key is generated — dev/test only.
 *   IDENTITY_BROKER_AUDIT_LOG    path to JSONL audit log. If absent, defaults
 *                                to ./audit.jsonl. Used when
 *                                FORA_AUDIT_SINK=jsonl.
 *   IDENTITY_BROKER_NODE_ENV     'production' | 'development' | 'test'
 *                                (controls cookie Secure flag, log verbosity)
 *   FORA_AUDIT_SINK              'jsonl' (default) | 'fora'. Selects the
 *                                AuditSink implementation at boot. The JSONL
 *                                sink is the test default and the FORA-36
 *                                outage fallback.
 *   FORA_AUDIT_SINK_URL          base URL of the FORA-36 append-only event
 *                                store. Required when FORA_AUDIT_SINK=fora.
 *                                e.g. https://audit.fora.example
 *   FORA_AUDIT_SINK_TOKEN        bearer token for service-to-service auth
 *                                against FORA-36. Optional in dev; required
 *                                in production.
 */

import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { generateSigningKeypair } from '@fora/session-tokens';
import type { OidcClientConfig } from '@fora/oidc-clients';

const EnvSchema = z.object({
  IDENTITY_BROKER_LISTEN_HOST: z.string().default('0.0.0.0'),
  IDENTITY_BROKER_LISTEN_PORT: z.coerce.number().int().positive().default(8080),
  IDENTITY_BROKER_PUBLIC_URL: z.string().url(),
  IDENTITY_BROKER_TENANT_CONFIG: z.string().optional(),
  IDENTITY_BROKER_TENANT_WEBHOOK_SECRETS: z.string().optional(),
  IDENTITY_BROKER_SIGNING_KEY: z.string().optional(),
  IDENTITY_BROKER_AUDIT_LOG: z.string().default('./audit.jsonl'),
  IDENTITY_BROKER_NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  FORA_AUDIT_SINK: z.enum(['jsonl', 'fora']).default('jsonl'),
  FORA_AUDIT_SINK_URL: z.string().url().optional(),
  FORA_AUDIT_SINK_TOKEN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export interface BrokerConfig {
  listen_host: string;
  listen_port: number;
  public_url: string;
  issuer: string; // e.g. https://identity.fora.example
  audience: string; // e.g. forge-runtime
  tenant_config_path: string | null;
  /** Map<tenant_id, OidcClientConfig> */
  tenants: Map<string, OidcClientConfig>;
  /**
   * Per-tenant shared secret used to verify inbound IdP revocation
   * webhooks. Tenants absent from this map do not accept /auth/idp-revoke
   * (the handler returns 404 with a 401-audit so probing for valid
   * tenants is no easier than probing for valid signatures).
   */
  tenant_webhook_secrets: Map<string, string>;
  signing_key: Awaited<ReturnType<typeof generateSigningKeypair>>;
  audit_log_path: string;
  audit_sink_kind: 'jsonl' | 'fora';
  audit_sink_url: string | null;
  audit_sink_token: string | null;
  env: 'production' | 'development' | 'test';
}

let cached: BrokerConfig | null = null;

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<BrokerConfig> {
  if (cached) return cached;
  const parsed = EnvSchema.parse(env);
  const tenants = new Map<string, OidcClientConfig>();
  if (parsed.IDENTITY_BROKER_TENANT_CONFIG && existsSync(parsed.IDENTITY_BROKER_TENANT_CONFIG)) {
    const raw = readFileSync(parsed.IDENTITY_BROKER_TENANT_CONFIG, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, OidcClientConfig & { webhook_secret?: string }>;
    for (const [tid, cfg] of Object.entries(obj)) {
      tenants.set(tid, cfg);
    }
  }
  const tenant_webhook_secrets = new Map<string, string>();
  if (parsed.IDENTITY_BROKER_TENANT_WEBHOOK_SECRETS && existsSync(parsed.IDENTITY_BROKER_TENANT_WEBHOOK_SECRETS)) {
    const raw = readFileSync(parsed.IDENTITY_BROKER_TENANT_WEBHOOK_SECRETS, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [tid, secret] of Object.entries(obj)) {
      if (typeof secret === 'string' && secret.length > 0) {
        tenant_webhook_secrets.set(tid, secret);
      }
    }
  }
  const signing_key = parsed.IDENTITY_BROKER_SIGNING_KEY
    ? await loadSigningKey(parsed.IDENTITY_BROKER_SIGNING_KEY)
    : await generateSigningKeypair();

  cached = {
    listen_host: parsed.IDENTITY_BROKER_LISTEN_HOST,
    listen_port: parsed.IDENTITY_BROKER_LISTEN_PORT,
    public_url: parsed.IDENTITY_BROKER_PUBLIC_URL,
    issuer: new URL('/auth', parsed.IDENTITY_BROKER_PUBLIC_URL).toString().replace(/\/$/, ''),
    audience: 'forge-runtime',
    tenant_config_path: parsed.IDENTITY_BROKER_TENANT_CONFIG ?? null,
    tenants,
    tenant_webhook_secrets,
    signing_key,
    audit_log_path: parsed.IDENTITY_BROKER_AUDIT_LOG,
    audit_sink_kind: parsed.FORA_AUDIT_SINK,
    audit_sink_url: parsed.FORA_AUDIT_SINK_URL ?? null,
    audit_sink_token: parsed.FORA_AUDIT_SINK_TOKEN ?? null,
    env: parsed.IDENTITY_BROKER_NODE_ENV,
  };
  return cached;
}

async function loadSigningKey(
  source: string,
): Promise<Awaited<ReturnType<typeof generateSigningKeypair>>> {
  if (source.startsWith('{')) {
    // Raw JWK JSON
    const jwk = JSON.parse(source);
    const { importJWK, exportJWK, generateKeyPair } = await import('jose');
    const priv = (await importJWK(jwk, 'ES256')) as Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
    const { publicKey } = await generateKeyPair('ES256');
    // We don't have the public key; export it from the private.
    const pub = (await exportJWK(priv)) as Awaited<ReturnType<typeof exportJWK>>;
    void publicKey;
    return {
      privateKey: priv,
      publicKey: priv as unknown as Awaited<ReturnType<typeof generateKeyPair>>['publicKey'],
      privateJwk: jwk,
      publicJwk: pub,
    };
  }
  // Treat as a path
  const raw = readFileSync(source, 'utf-8');
  return loadSigningKey(raw);
}

/** Reset the cache. Tests use this to swap configs between cases. */
export function _resetConfigForTests(): void {
  cached = null;
}
