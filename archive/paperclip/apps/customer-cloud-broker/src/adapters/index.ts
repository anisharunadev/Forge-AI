/**
 * Adapter index. The broker constructs a per-cloud adapter registry
 * at boot. Adding a new cloud is a one-line addition here once the
 * adapter itself lands.
 */

import type { Cloud, CloudAdapter } from '../types.js';
import { AwsAdapter } from './aws.js';
import { AzureAdapter } from './azure.js';
import { GcpAdapter } from './gcp.js';
import { SonarQubeAdapter } from './sonarqube.js';

export interface AdapterRegistry {
  get(cloud: Cloud): CloudAdapter | undefined;
}

export function buildAdapterRegistry(opts: {
  aws?: AwsAdapter;
  azure?: AzureAdapter;
  gcp?: GcpAdapter;
  sonarqube?: SonarQubeAdapter;
}): AdapterRegistry {
  const map = new Map<Cloud, CloudAdapter>();
  if (opts.aws) map.set('aws', opts.aws);
  if (opts.azure) map.set('azure', opts.azure);
  if (opts.gcp) map.set('gcp', opts.gcp);
  if (opts.sonarqube) map.set('sonarqube', opts.sonarqube);
  return {
    get(cloud) {
      return map.get(cloud);
    },
  };
}
