/**
 * Bridge between the vendored @forge-ai/forge-core / forge-pi / forge-browser
 * catalogs and the Forge Command Center UI.
 *
 * The source of truth for `forge-*` command definitions lives in:
 *   - `packages/forge-core/forge-core.catalog.json`    (workflow methodology)
 *   - `packages/forge-pi/forge-pi.catalog.json`        (product intelligence)
 *   - `packages/forge-browser/forge-browser.catalog.json` (browser automation)
 *
 * Each catalog is generated from the upstream vendored markdown / skill
 * registry. This file:
 *
 *   1. Reads all three catalogs at build time.
 *   2. Re-shapes each entry to the `ForgeCommand` shape consumed by the UI.
 *   3. Adds the `package` field so the Command Center can render the
 *      "Core workflow" / "Product intelligence" / "Browser automation" tabs.
 *
 * If a catalog is unavailable (e.g. local dev before the package is built,
 * or the optional package is not installed), we skip it silently — the
 * Command Center degrades gracefully to whatever IS available.
 *
 * Step 45 — 3-Package Spec-Driven Stack (ZONE 3).
 */

import forgeCoreCatalog from '@forge-ai/forge-core/forge-core.catalog.json';
import {
  FORGE_COMMAND_CATEGORIES,
  type ForgeCommand,
  type ForgeCommandCategoryId,
  type ForgeCommandPackageId,
} from './forge-commands';

interface VendorCatalogEntry {
  id: string;
  name: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  estimatedDuration?: number;
  sourceFile: string;
  skillFile: string | null;
  /** New in Step 45 — present on forge-pi and forge-browser catalogs. */
  package?: string;
}

interface VendorCatalog {
  $schema: string;
  generatedAt: string;
  engineVersion: string;
  enginePackage: string;
  /** Step 45 — drives Command Center tab grouping. */
  packageCategory?: string;
  commandCount: number;
  commands: VendorCatalogEntry[];
}

const VALID_CATEGORIES = new Set<string>(
  FORGE_COMMAND_CATEGORIES.map((c) => c.id),
);

function coerceCategory(raw: string): ForgeCommandCategoryId {
  return VALID_CATEGORIES.has(raw)
    ? (raw as ForgeCommandCategoryId)
    : 'operational';
}

/**
 * Map a raw `package` field on a catalog entry to the canonical
 * `ForgeCommandPackageId`. Defaults to `forge-core` when the field is
 * absent (which is the case for the legacy forge-core catalog).
 */
function coercePackage(raw: string | undefined): ForgeCommandPackageId {
  if (raw === '@forge-ai/forge-pi' || raw === 'forge-pi') return 'forge-pi';
  if (raw === '@forge-ai/forge-browser' || raw === 'forge-browser')
    return 'forge-browser';
  return 'forge-core';
}

/* ------------------------------------------------------------------ */
/* forge-core — workflow methodology (always wired)                   */
/* ------------------------------------------------------------------ */

export const FORGE_CORE_CATALOG = forgeCoreCatalog as VendorCatalog;

/* ------------------------------------------------------------------ */
/* forge-pi — product intelligence (optional, graceful degradation)   */
/* ------------------------------------------------------------------ */

interface OptionalCatalogModule {
  default: unknown;
}

let _forgePiCatalog: VendorCatalog | null = null;
let _forgeBrowserCatalog: VendorCatalog | null = null;

/**
 * Resolve an optional workspace package's catalog JSON. Returns null if
 * the package is not installed — the Command Center then degrades to
 * whatever IS available. This is what gives us the "optional by design"
 * guarantee from Step 45's constraints.
 */
async function tryImportCatalog(
  specifier: string,
): Promise<VendorCatalog | null> {
  try {
    // Use a runtime import so a missing dep becomes null instead of
    // breaking the build. Vite/Next will tree-shake the dynamic import
    // when the package is present at build time.
    const mod = (await import(/* @vite-ignore */ specifier)) as OptionalCatalogModule;
    const candidate = mod.default as VendorCatalog | undefined;
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.commands)) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Synchronous accessor — only usable after the async warm-up has resolved.
 * Used by SSR / RSC paths where the request is single-threaded.
 */
export function getForgePiCatalog(): VendorCatalog | null {
  return _forgePiCatalog;
}

export function getForgeBrowserCatalog(): VendorCatalog | null {
  return _forgeBrowserCatalog;
}

/**
 * Warm-up entry point — call once on app boot so subsequent reads are
 * synchronous. Idempotent.
 */
export async function warmForgeCatalogs(): Promise<void> {
  if (!_forgePiCatalog) {
    _forgePiCatalog = await tryImportCatalog('@forge-ai/forge-pi/forge-pi.catalog.json');
  }
  if (!_forgeBrowserCatalog) {
    _forgeBrowserCatalog = await tryImportCatalog(
      '@forge-ai/forge-browser/forge-browser.catalog.json',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Unified command list — every package together                      */
/* ------------------------------------------------------------------ */

function fromCatalog(
  catalog: VendorCatalog,
  pkg: ForgeCommandPackageId,
): readonly ForgeCommand[] {
  return catalog.commands.map((entry) => ({
    name: entry.name,
    label: entry.label,
    description:
      entry.description ||
      `Forge command from ${entry.sourceFile}. Edit SKILL.md to customize.`,
    category: coerceCategory(entry.category),
    icon: entry.icon || 'Wand2',
    estimatedDuration: entry.estimatedDuration ?? 60,
    package: pkg,
  }));
}

export const FORGE_COMMANDS_FROM_VENDOR: readonly ForgeCommand[] = (() => {
  const out: ForgeCommand[] = [
    ...fromCatalog(FORGE_CORE_CATALOG, 'forge-core'),
  ];
  // forge-pi and forge-browser catalogs are filled in by warmForgeCatalogs
  // when available. SSR / RSC reads fall back to forge-core only.
  if (_forgePiCatalog) {
    out.push(...fromCatalog(_forgePiCatalog, 'forge-pi'));
  }
  if (_forgeBrowserCatalog) {
    out.push(...fromCatalog(_forgeBrowserCatalog, 'forge-browser'));
  }
  return out;
})();

/**
 * Group commands by their originating package. The Command Center
 * renders one tab per group: "Core workflow" / "Product intelligence" /
 * "Browser automation".
 */
export function commandsByPackage(): Record<ForgeCommandPackageId, ForgeCommand[]> {
  const out: Record<ForgeCommandPackageId, ForgeCommand[]> = {
    'forge-core': [],
    'forge-pi': [],
    'forge-browser': [],
  };
  for (const cmd of FORGE_COMMANDS_FROM_VENDOR) {
    const pkg: ForgeCommandPackageId = cmd.package ?? 'forge-core';
    out[pkg].push(cmd);
  }
  return out;
}

export type { VendorCatalog, VendorCatalogEntry };
export { coercePackage };