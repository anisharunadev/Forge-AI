/**
 * Process entrypoint — load config, build server, listen.
 *
 * Imports the lazy `loadConfig` so tests don't pull this in.
 */

import { loadConfig } from './config.js';
import { buildServer, ForaAuditSink, JsonlAuditSink } from './server.js';

export async function startServer(): Promise<void> {
  const config = await loadConfig();
  const audit = createAuditSink(config);
  const app = await buildServer({
    config,
    audit,
    revocation: new (await import('./server.js')).InMemoryRevocationStore(),
    provisioning: new (await import('./server.js')).InMemoryProvisioningStore(),
    state: new (await import('./server.js')).InMemoryStateStore(),
  });
  await app.listen({ host: config.listen_host, port: config.listen_port });
  // eslint-disable-next-line no-console
  console.log(
    `[identity-broker] listening on http://${config.listen_host}:${config.listen_port} (audit_sink=${config.audit_sink_kind})`,
  );
}

/**
 * Pick the audit sink based on `FORA_AUDIT_SINK` (FORA-160). The JSONL
 * sink is the always-available fallback; the FORA-36 sink is the
 * production default once FORA-36 has a stable append API.
 */
function createAuditSink(config: import('./config.js').BrokerConfig): import('./audit.js').AuditSink {
  if (config.audit_sink_kind === 'fora') {
    if (!config.audit_sink_url) {
      throw new Error(
        'audit: FORA_AUDIT_SINK=fora requires FORA_AUDIT_SINK_URL to be set to the FORA-36 base URL',
      );
    }
    return new ForaAuditSink({
      baseUrl: config.audit_sink_url,
      token: config.audit_sink_token,
    });
  }
  return new JsonlAuditSink(config.audit_log_path);
}

// Run when invoked directly (not when imported by tests).
const isMain = (() => {
  try {
    // Node 20+: process.argv[1] is the script path.
    return process.argv[1]?.endsWith('start.ts') || process.argv[1]?.endsWith('start.js');
  } catch {
    return false;
  }
})();
if (isMain) {
  startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[identity-broker] failed to start', err);
    process.exit(1);
  });
}
