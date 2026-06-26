'use client';

/**
 * Terminal — Layout switcher (segmented control).
 *
 * Four layout modes for the terminal panel:
 *   - single               One pane (the default).
 *   - split-horizontal     Two panes stacked top/bottom.
 *   - split-vertical       Two panes side by side.
 *   - grid-2x2             Up to four panes in a 2×2 grid.
 *
 * Reuses the Agent Center SegmentedControl pattern (Step 4) so the
 * active pill glides between segments instead of snapping.
 *
 * Skill influence:
 *   - ux-guideline (feedback) — visible active state, no color-only
 *     signal (the label is always paired with the icon).
 */

import {
  LayoutGrid,
  Maximize2,
  Columns,
  Rows,
  type LucideIcon,
} from 'lucide-react';

import { SegmentedControl } from '@/components/agent-center/AgentCenterControls';
import { useTerminalStore, type LayoutMode } from '@/lib/store';

const LAYOUT_OPTIONS: ReadonlyArray<{
  value: LayoutMode;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'single', label: 'Single', icon: Maximize2 },
  { value: 'split-horizontal', label: 'Split H', icon: Rows },
  { value: 'split-vertical', label: 'Split V', icon: Columns },
  { value: 'grid-2x2', label: 'Grid 2×2', icon: LayoutGrid },
];

export function LayoutSwitcher() {
  const layout = useTerminalStore((s) => s.layout);
  const setLayout = useTerminalStore((s) => s.setLayout);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--fg-tertiary)]">
        Layout
      </span>
      <SegmentedControl
        value={layout}
        onChange={(v) => setLayout(v as LayoutMode)}
        ariaLabel="Terminal layout"
        options={LAYOUT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          testId: `layout-${o.value}`,
        }))}
      />
    </div>
  );
}
