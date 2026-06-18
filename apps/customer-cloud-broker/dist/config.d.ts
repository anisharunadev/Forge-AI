/**
 * Broker configuration. Loaded from env + a YAML file at boot.
 */
import { z } from 'zod';
declare const ConfigSchema: z.ZodObject<{
    listen_host: z.ZodDefault<z.ZodString>;
    listen_port: z.ZodDefault<z.ZodNumber>;
    public_url: z.ZodString;
    issuer: z.ZodString;
    audience: z.ZodString;
    deny_list_path: z.ZodString;
    tenant_trust_root: z.ZodString;
    audit_log_path: z.ZodString;
    env: z.ZodDefault<z.ZodEnum<["test", "development", "production"]>>;
    /** The broker's OIDC audience — also the customer's trust policy audience. */
    broker_audience: z.ZodString;
}, "strict", z.ZodTypeAny, {
    audience: string;
    listen_host: string;
    listen_port: number;
    public_url: string;
    issuer: string;
    deny_list_path: string;
    tenant_trust_root: string;
    audit_log_path: string;
    env: "test" | "development" | "production";
    broker_audience: string;
}, {
    audience: string;
    public_url: string;
    issuer: string;
    deny_list_path: string;
    tenant_trust_root: string;
    audit_log_path: string;
    broker_audience: string;
    listen_host?: string | undefined;
    listen_port?: number | undefined;
    env?: "test" | "development" | "production" | undefined;
}>;
export type BrokerConfig = z.infer<typeof ConfigSchema>;
export declare function loadConfigFromEnv(env?: NodeJS.ProcessEnv): BrokerConfig;
export {};
