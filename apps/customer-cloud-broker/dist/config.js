/**
 * Broker configuration. Loaded from env + a YAML file at boot.
 */
import { z } from 'zod';
const ConfigSchema = z
    .object({
    listen_host: z.string().default('127.0.0.1'),
    listen_port: z.number().int().positive().default(7100),
    public_url: z.string().url(),
    issuer: z.string().url(),
    audience: z.string().min(1),
    deny_list_path: z.string().min(1),
    tenant_trust_root: z.string().min(1),
    audit_log_path: z.string().min(1),
    env: z.enum(['test', 'development', 'production']).default('development'),
    /** The broker's OIDC audience — also the customer's trust policy audience. */
    broker_audience: z.string().min(1),
})
    .strict();
export function loadConfigFromEnv(env = process.env) {
    return ConfigSchema.parse({
        listen_host: env.FORA_CCB_LISTEN_HOST,
        listen_port: env.FORA_CCB_LISTEN_PORT ? Number(env.FORA_CCB_LISTEN_PORT) : undefined,
        public_url: env.FORA_CCB_PUBLIC_URL,
        issuer: env.FORA_CCB_ISSUER,
        audience: env.FORA_CCB_AUDIENCE ?? 'customer-cloud-broker',
        deny_list_path: env.FORA_CCB_DENY_LIST_PATH ?? 'config/customer-cloud-broker/deny_list.yaml',
        tenant_trust_root: env.FORA_CCB_TENANT_TRUST_ROOT ?? 'tenants',
        audit_log_path: env.FORA_CCB_AUDIT_LOG_PATH ?? '/tmp/fora-customer-cloud-broker-audit.jsonl',
        env: env.FORA_CCB_ENV ?? 'development',
        broker_audience: env.FORA_CCB_BROKER_AUDIENCE ?? 'customer-cloud-broker',
    });
}
