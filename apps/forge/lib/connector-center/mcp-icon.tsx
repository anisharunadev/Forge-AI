/**
 * MCP icon resolver — maps the `MCPServerDefinition.icon` string from
 * `lib/mcp-registry.ts` to a lucide-react icon component.
 *
 * The registry stores `icon` as a string (e.g. 'Github', 'CheckSquare')
 * to keep the registry data-only and free of React/lucide imports.
 * This module is the single typed bridge between the registry and the
 * lucide icon set used throughout the forge console.
 *
 * Resolution order:
 *   1. Per-connector id override (for aliases like `azdo` -> AzureDevOps).
 *   2. The registry's `icon` field if it maps to a known lucide icon.
 *   3. A category-aware fallback (Plug for source-control, etc.).
 *   4. Generic `Plug` last resort.
 */

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CheckSquare,
  Cloud,
  Database,
  GitBranch,
  Headphones,
  Key,
  LayoutGrid,
  MessageSquare,
  Network,
  Palette,
  PenTool,
  Plug,
  Shield,
  Sparkles,
  BookOpen,
} from 'lucide-react';

import { getMCPServer } from '@/lib/mcp-registry';
import type { MCPCategory } from '@/lib/mcp-registry';

// Lucide dropped brand icons in 1.x (Github, Slack, Trello, Figma). For
// Forge's brand-icon registry entries we use the closest generic
// semantic match so the connector marketplace still reads correctly:
//
//   Github   -> GitBranch   (source-control metaphor)
//   Slack    -> MessageSquare (chat / communication)
//   Trello   -> LayoutGrid  (board / card metaphor)
//   Figma    -> Palette     (design tool metaphor)
//
// If a downstream consumer needs the real brand mark, swap these for
// a `simple-icons` import in their own module.

/** Connectors whose lucide icon name doesn't match the registry's `icon` field. */
const ID_OVERRIDES: Readonly<Record<string, LucideIcon>> = {
  // The registry uses 'Trello' as a stand-in for Jira; Jira has no native
  // lucide icon, so we keep the Jira-shaped card using CheckSquare.
  jira: CheckSquare,
  // Adobe XD has no dedicated lucide icon — PenTool is the closest fit.
  adobe_xd: PenTool,
  // Kiro — Sparkles signals the AI/agentic nature of the connector.
  kiro: Sparkles,
};

/** Direct mapping from the registry's `icon` string to a lucide icon. */
const ICON_BY_NAME: Readonly<Record<string, LucideIcon>> = {
  Github: GitBranch,
  Trello: LayoutGrid,
  BookOpen,
  Figma: Palette,
  Slack: MessageSquare,
  Cloud,
  GitBranch,
  Shield,
  Key,
  CheckSquare,
  Headphones,
  Database,
  Network,
  PenTool,
  Sparkles,
};

/** Category-level fallback so a missing icon still feels coherent. */
const ICON_BY_CATEGORY: Readonly<Record<MCPCategory, LucideIcon>> = {
  version_control: GitBranch,
  project_management: CheckSquare,
  documentation: BookOpen,
  design: Palette,
  communication: MessageSquare,
  cloud: Cloud,
  security: Shield,
  analytics: Database,
  support: Headphones,
};

/**
 * Resolve a lucide icon for a given MCP connector id.
 *
 * Returns the matching lucide component, or `Plug` as the last-resort
 * fallback. Never returns `undefined` — the consumer always renders an icon.
 */
export function resolveMCPIcon(connectorId: string): LucideIcon {
  const override = ID_OVERRIDES[connectorId];
  if (override) return override;

  const server = getMCPServer(connectorId);
  if (server?.icon) {
    const named = ICON_BY_NAME[server.icon];
    if (named) return named;
  }

  if (server?.category) {
    return ICON_BY_CATEGORY[server.category];
  }

  return Plug;
}

export interface MCPIconProps {
  connectorId: string;
  className?: string;
}

/** Convenience component — `resolveMCPIcon(id)` + render at a fixed size. */
export function MCPIcon({ connectorId, className }: MCPIconProps): React.ReactElement {
  const Icon = resolveMCPIcon(connectorId);
  return <Icon className={className} aria-hidden="true" />;
}