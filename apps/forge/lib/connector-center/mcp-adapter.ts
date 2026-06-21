/**
 * Adapter that converts MCP registry entries into the
 * `MarketplaceConnector` shape consumed by the existing
 * `MarketplaceCard` / `MarketplaceGrid` components.
 *
 * This keeps the visual layer unchanged while letting the data
 * source swap from the legacy mock list to the real registry.
 */

import {
  CATEGORY_LABELS,
  listMCPServers,
  type MCPCategory,
  type MCPServerDefinition,
} from '@/lib/mcp-registry';
import {
  CATEGORY_LABEL,
  type ConnectorCategory,
  type MarketplaceConnector,
} from '@/lib/connector-center/data';

const MCPCATEGORY_TO_CONNECTOR_CATEGORY: Readonly<Record<MCPCategory, ConnectorCategory>> = {
  version_control: 'source-control',
  project_management: 'project-mgmt',
  documentation: 'project-mgmt',
  design: 'design',
  communication: 'comms',
  cloud: 'cloud',
  security: 'quality',
  analytics: 'data',
  support: 'quality',
};

const RATING_BY_NAME: Readonly<Record<string, number>> = {
  github: 4.8,
  jira: 4.6,
  confluence: 4.5,
  figma: 4.4,
  slack: 4.7,
  aws: 4.5,
  azure_devops: 4.3,
  sonarqube: 4.2,
  secrets: 4.0,
  clickup: 4.1,
  zendesk: 4.0,
  databricks: 4.4,
  arch_analyzer: 4.6,
  adobe_xd: 4.0,
  kiro: 4.5,
};

const INSTALLS_BY_NAME: Readonly<Record<string, number>> = {
  github: 12480,
  jira: 9320,
  confluence: 6210,
  figma: 4810,
  slack: 11220,
  aws: 7450,
  azure_devops: 2980,
  sonarqube: 3120,
  secrets: 1640,
  clickup: 2120,
  zendesk: 1980,
  databricks: 1730,
  arch_analyzer: 890,
  adobe_xd: 1450,
  kiro: 2380,
};

function toMarketplaceConnector(server: MCPServerDefinition): MarketplaceConnector {
  return {
    id: server.name,
    name: server.name,
    displayName: server.displayName,
    category: MCPCATEGORY_TO_CONNECTOR_CATEGORY[server.category],
    publisher: 'Forge Team',
    shortDescription: server.description,
    rating: RATING_BY_NAME[server.name] ?? 4.0,
    installs: INSTALLS_BY_NAME[server.name] ?? 0,
  };
}

export function listMarketplaceFromRegistry(): ReadonlyArray<MarketplaceConnector> {
  return listMCPServers().map(toMarketplaceConnector);
}

export function getMarketplaceFromRegistry(name: string): MarketplaceConnector | undefined {
  const server = listMCPServers().find((s) => s.name === name);
  return server ? toMarketplaceConnector(server) : undefined;
}

export function getMCPCategoryLabel(category: MCPCategory): string {
  return CATEGORY_LABELS[category];
}

export { CATEGORY_LABEL };
