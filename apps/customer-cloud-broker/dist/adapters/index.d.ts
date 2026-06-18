/**
 * Adapter index. The broker constructs a per-cloud adapter registry
 * at boot. Adding a new cloud is a one-line addition here once the
 * adapter itself lands.
 */
import type { Cloud, CloudAdapter } from '../types.js';
import { AwsAdapter } from './aws.js';
import { AzureAdapter } from './azure.js';
import { GcpAdapter } from './gcp.js';
export interface AdapterRegistry {
    get(cloud: Cloud): CloudAdapter | undefined;
}
export declare function buildAdapterRegistry(opts: {
    aws?: AwsAdapter;
    azure?: AzureAdapter;
    gcp?: GcpAdapter;
}): AdapterRegistry;
