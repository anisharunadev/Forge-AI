'use client';

import * as React from 'react';

import {
  FORGE_COMMANDS_FROM_VENDOR,
  commandsByPackage,
  warmForgeCatalogs,
} from '@/lib/forge-commands-catalog';
import {
  type ForgeCommand,
  type ForgeCommandPackageId,
} from '@/lib/forge-commands';
import { CategoryNav } from './CategoryNav';
import { PackageNav } from './PackageNav';
import { CommandCard } from './CommandCard';

export interface ForgeSkillPickerProps {
  /** Optional initial package — defaults to 'forge-core'. */
  initialPackage?: ForgeCommandPackageId;
  /** Optional initial category — defaults to the first one in the active package. */
  initialCategory?: string;
}

/**
 * Step 45 — 3-Package Spec-Driven Stack.
 *
 * The unified skill picker. Renders the 3-package tab bar on top and the
 * category nav on the left, then a grid of command cards filtered by both.
 *
 * The `warmForgeCatalogs()` call is fire-and-forget — it augments
 * `FORGE_COMMANDS_FROM_VENDOR` with forge-pi + forge-browser entries once
 * those workspace packages resolve. If either package is not installed
 * the tab still renders (dimmed) per the "degrades gracefully" rule.
 */
export function ForgeSkillPicker({
  initialPackage = 'forge-core',
}: ForgeSkillPickerProps) {
  const [activePackage, setActivePackage] =
    React.useState<ForgeCommandPackageId>(initialPackage);
  const [activeCategory, setActiveCategory] = React.useState<string>('all');
  // Bumped whenever FORGE_COMMANDS_FROM_VENDOR grows so the memo recomputes.
  const [revision, setRevision] = React.useState(0);

  // Warm up the optional catalogs once on mount.
  React.useEffect(() => {
    void warmForgeCatalogs().then(() => setRevision((r) => r + 1));
  }, []);

  const grouped = React.useMemo(
    () => commandsByPackage(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revision, FORGE_COMMANDS_FROM_VENDOR.length],
  );

  const counts: Record<ForgeCommandPackageId, number | null> = {
    'forge-core': grouped['forge-core'].length,
    'forge-pi': grouped['forge-pi'].length > 0 ? grouped['forge-pi'].length : null,
    'forge-browser':
      grouped['forge-browser'].length > 0 ? grouped['forge-browser'].length : null,
  };

  const visibleCommands: ForgeCommand[] = React.useMemo(() => {
    const list = grouped[activePackage] ?? [];
    if (activeCategory === 'all') return list;
    return list.filter((c) => c.category === activeCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, activePackage, activeCategory, revision]);

  return (
    <section
      aria-label="Forge skill picker"
      className="flex w-full flex-col"
      data-testid="forge-skill-picker"
    >
      <PackageNav active={activePackage} onChange={setActivePackage} counts={counts} />
      <div className="flex w-full">
        <CategoryNav
          active={activeCategory as never}
          onChange={(id) => setActiveCategory(id)}
        />
        <div className="grid flex-1 grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleCommands.length === 0 ? (
            <p className="col-span-full rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No commands in this package yet.
            </p>
          ) : (
            visibleCommands.map((cmd) => (
              <CommandCard key={cmd.name} command={cmd} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}