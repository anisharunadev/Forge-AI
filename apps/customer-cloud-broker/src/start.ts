/**
 * Service entrypoint. Wires the config, deny-list, trust store,
 * adapters, audit sink, metrics, and probe scheduler, then starts
 * the Fastify server.
 */

import { resolve } from 'node:path';
import { buildServer } from './server.js';
import { loadConfigFromEnv } from './config.js';
import { buildDenyListMatcher } from './deny-list.js';
import { discoverTenantTrusts, TrustStore } from './trust.js';
import { buildAdapterRegistry } from './adapters/index.js';
import { AwsAdapter } from './adapters/aws.js';
import { AzureAdapter } from './adapters/azure.js';
import { GcpAdapter } from './adapters/gcp.js';
import { BrokerMetrics } from './metrics.js';
import { JsonlAuditSink } from './audit.js';
import { ProbeProbeSigner, type ProbeProbeSignerOptions } from './probe-signer.js';
import { ProbeScheduler, PROBE_INTERVAL_MS_DEFAULT } from './probe-scheduler.js';

export async function start(): Promise<void> {
  const config = loadConfigFromEnv();
  const repoRoot = process.env.FORA_REPO_ROOT ?? process.cwd();

  const deny = buildDenyListMatcher(resolve(repoRoot, config.deny_list_path), {
    baseDir: repoRoot,
  });

  const trust_store = new TrustStore();
  const discovered = discoverTenantTrusts(resolve(repoRoot, config.tenant_trust_root));
  for (const t of discovered) {
    trust_store.loadTenant(t.tenant_id, t.source, { baseDir: repoRoot });
  }

  const adapters = buildAdapterRegistry({
    aws: new AwsAdapter({
      broker_issuer: config.issuer,
      broker_audience: config.broker_audience,
    }),
    azure: new AzureAdapter(),
    gcp: new GcpAdapter({
      broker_issuer: config.issuer,
      broker_audience: config.broker_audience,
    }),
  });
  // The Azure adapter is constructed with no options by default; it
  // uses the production `ClientAssertionCredential` factory. The trust
  // store's phase-1 probe validates `expected_issuer` / `expected_audience`
  // against `config.issuer` / `config.broker_audience` before any
  // brokered action reaches the adapter, so the adapter itself does
  // not need those values at runtime.

  const audit = new JsonlAuditSink(config.audit_log_path);
  const metrics = new BrokerMetrics();

  // Probe JWT signer (FORA-126.4). The signing key is loaded from
  // KMS / a secret store; v1 reads a single env var. Production
  // reuses the identity-broker's `TokenIssuer` over IPC.
  const signerOpts: ProbeProbeSignerOptions = {
    issuer: config.issuer,
    audience: config.broker_audience,
    signing_key: await loadProbeSigningKey(),
  };
  const probe_signer = new ProbeProbeSigner(signerOpts);
  const probe_interval_ms = Number(
    process.env.FORA_CCB_PROBE_INTERVAL_MS ?? PROBE_INTERVAL_MS_DEFAULT,
  );
  const probe_scheduler = new ProbeScheduler({
    trust_store,
    adapters,
    signer: probe_signer,
    audit,
    interval_ms: probe_interval_ms,
  });
  // Run a boot-time sweep so every tenant has a known state before
  // the first request lands. Errors are logged but do not block the
  // server from accepting traffic — a tenant that was previously
  // active stays active until the first re-probe tick.
  void probe_scheduler.probeAll().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[customer-cloud-broker] boot probe sweep failed', err);
  });
  probe_scheduler.start();

  const app = await buildServer({
    config,
    audit,
    metrics,
    trust_store,
    deny_list: deny.matcher,
    adapters,
    /**
     * Mint the FORA-issued JWT that the broker exchanges at the
     * customer's IdP / STS. The full implementation reuses the
     * identity-broker's `TokenIssuer` (FORA-123) — v1 of this broker
     * signs the probe / canary token locally with the same key.
     * Production: import the TokenIssuer over IPC.
     */
    async mint_fora_jwt(request) {
      // Stub: a real implementation uses the identity-broker's
      // TokenIssuer over IPC, signed with the broker's key, with the
      // claim set from ADR-0003 §3.2.
      return `stub.fora.jwt.${request.tenant_id}.${request.trace_id}`;
    },
  });

  await app.listen({ host: config.listen_host, port: config.listen_port });
  // eslint-disable-next-line no-console
  console.log(
    `[customer-cloud-broker] listening on ${config.listen_host}:${config.listen_port} (probe every ${probe_interval_ms}ms)`,
  );
}

/**
 * Load the ES256 signing key for the probe JWT minter. v1 reads a
 * single env var holding a base64url-encoded JWK or PEM. The prod
 * path is to pull from KMS / a secret store and import via
 * `jose.importJWK`. If no key is configured (dev only), we generate
 * an ephemeral P-256 keypair so the broker still boots; probes will
 * be signed with a per-process key and the customer's trust policy
 * will reject them, which is the expected behaviour in dev.
 */
async function loadProbeSigningKey(): Promise<Uint8Array | import('jose').KeyLike> {
  const raw = process.env.FORA_CCB_PROBE_SIGNING_KEY;
  if (raw) {
    return new TextEncoder().encode(raw);
  }
  // Dev fallback: real ES256 keypair so the broker boots and the
  // probe path runs end-to-end against a mock STS. The customer's
  // trust policy will reject this key in production — that's why
  // we require FORA_CCB_PROBE_SIGNING_KEY in prod deployments.
  const { generateKeyPair, exportJWK } = await import('jose');
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  return privateKey;
}
