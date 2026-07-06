/**
 * Migration Guide generator (Step 30 Zone 9).
 * User picks two versions; component generates a Markdown migration
 * guide covering deprecations, breaking API changes, and required
 * ADR-driven action items. Output can be copied or downloaded.
 */

'use client';

import * as React from 'react';
import { FileDown, ClipboardCopy, GitCompareArrows, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ArchitectureVersion } from '@/lib/architecture/data';

export interface MigrationGuideProps {
  versions: ReadonlyArray<ArchitectureVersion>;
}

interface ChangeRow {
  category: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed';
  area: string;
  detail: string;
  impact: 'low' | 'medium' | 'high';
  adrRef?: string;
}

function diffVersions(from: ArchitectureVersion, to: ArchitectureVersion): ChangeRow[] {
  // Mock deterministic diff between two versions. Highlights from both
  // versions are deconstructed into categorized rows so the output is
  // plausible for the synthetic data we ship.
  const rows: ChangeRow[] = [];
  const all = [...from.highlights, ...to.highlights];
  all.forEach((h, idx) => {
    const lower = h.toLowerCase();
    if (lower.startsWith('add') || lower.startsWith('new') || lower.startsWith('introduce')) {
      rows.push({ category: 'added', area: 'Service', detail: h, impact: idx % 4 === 0 ? 'medium' : 'low' });
    } else if (lower.startsWith('deprecat')) {
      rows.push({ category: 'deprecated', area: 'API', detail: h, impact: 'medium', adrRef: 'ADR-002' });
    } else if (lower.startsWith('remov') || lower.startsWith('drop')) {
      rows.push({ category: 'removed', area: 'API', detail: h, impact: 'high', adrRef: 'ADR-002' });
    } else if (lower.startsWith('fix') || lower.startsWith('patch')) {
      rows.push({ category: 'fixed', area: 'Reliability', detail: h, impact: 'low' });
    } else {
      rows.push({ category: 'changed', area: 'Architecture', detail: h, impact: idx % 5 === 0 ? 'high' : 'medium', adrRef: 'ADR-003' });
    }
  });
  return rows;
}

function buildMarkdown(from: ArchitectureVersion, to: ArchitectureVersion, rows: ChangeRow[]): string {
  const head = `# Migration Guide — ${from.version} → ${to.version}\n\n`;
  const meta = `**Source:** \`${from.version}\` (${from.releasedAt}) · **Target:** \`${to.version}\` (${to.releasedAt})\n\n`;
  const groups = new Map<ChangeRow['category'], ChangeRow[]>();
  rows.forEach((r) => {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category)!.push(r);
  });
  const labels: Record<ChangeRow['category'], string> = {
    added: 'Added',
    changed: 'Changed',
    deprecated: 'Deprecated',
    removed: 'Removed',
    fixed: 'Fixed',
  };
  let body = '## Summary\n\n';
  body += `| Category | Count | High-impact |\n| --- | --- | --- |\n`;
  (['added', 'changed', 'deprecated', 'removed', 'fixed'] as const).forEach((c) => {
    const arr = groups.get(c) ?? [];
    body += `| ${labels[c]} | ${arr.length} | ${arr.filter((r) => r.impact === 'high').length} |\n`;
  });
  body += '\n## Action items\n\n';
  const highImpact = rows.filter((r) => r.impact === 'high');
  if (highImpact.length === 0) {
    body += '_No high-impact changes. Safe upgrade._\n\n';
  } else {
    highImpact.forEach((r) => {
      body += `- [ ] **${r.area}** — ${r.detail}${r.adrRef ? ` (see ${r.adrRef})` : ''}\n`;
    });
    body += '\n';
  }
  body += '## Detailed changelog\n\n';
  (['removed', 'deprecated', 'changed', 'added', 'fixed'] as const).forEach((c) => {
    const arr = groups.get(c);
    if (!arr || arr.length === 0) return;
    body += `### ${labels[c]}\n\n`;
    arr.forEach((r) => {
      body += `- \`${r.area}\` — ${r.detail}${r.adrRef ? ` — _${r.adrRef}_` : ''}\n`;
    });
    body += '\n';
  });
  return head + meta + body;
}

export function MigrationGuide({ versions }: MigrationGuideProps) {
  const [fromIdx, setFromIdx] = React.useState<number>(Math.max(0, versions.length - 2));
  const [toIdx, setToIdx] = React.useState<number>(Math.max(0, versions.length - 1));
  const [md, setMd] = React.useState<string>('');
  const [rows, setRows] = React.useState<ChangeRow[]>([]);

  const from = versions[fromIdx];
  const to = versions[toIdx];

  const generate = React.useCallback(() => {
    if (!from || !to) {
      toast.error('Select two versions to compare');
      return;
    }
    if (from.version === to.version) {
      toast.error('Pick two distinct versions');
      return;
    }
    const r = diffVersions(from, to);
    const m = buildMarkdown(from, to, r);
    setRows(r);
    setMd(m);
    toast.info(`Migration guide generated: ${from.version} → ${to.version}`, {
      description: `${r.length} changes detected`,
    });
  }, [from, to]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      toast.info('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };

  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-${from?.version ?? 'from'}-to-${to?.version ?? 'to'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.info('Migration guide downloaded');
  };

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" data-testid="migration-guide">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--fg-primary)]">
          <GitCompareArrows className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
          Migration guide generator
        </h3>
      </header>

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">From</span>
          <select
            value={fromIdx}
            onChange={(e) => setFromIdx(Number(e.target.value))}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            data-testid="migration-from"
          >
            {versions.map((v, i) => <option key={v.version} value={i}>{v.version}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--fg-tertiary)]">To</span>
          <select
            value={toIdx}
            onChange={(e) => setToIdx(Number(e.target.value))}
            className="rounded border border-[var(--border-subtle)] bg-[var(--bg-inset)] px-2 py-1 text-[var(--fg-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            data-testid="migration-to"
          >
            {versions.map((v, i) => <option key={v.version} value={i}>{v.version}</option>)}
          </select>
        </label>
        <Button
          size="sm"
          onClick={generate}
          data-testid="migration-generate"
          className="bg-[var(--accent-primary)] text-xs text-white hover:opacity-90"
        >
          Generate
        </Button>
        {md ? (
          <>
            <Button size="sm" variant="outline" onClick={copy} className="text-xs" data-testid="migration-copy">
              <ClipboardCopy className="mr-1 h-3 w-3" aria-hidden="true" /> Copy
            </Button>
            <Button size="sm" variant="outline" onClick={download} className="text-xs" data-testid="migration-download">
              <FileDown className="mr-1 h-3 w-3" aria-hidden="true" /> Download .md
            </Button>
          </>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-2 text-xs">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="migration-summary">
            {(['added', 'changed', 'deprecated', 'removed', 'fixed'] as const).map((c) => {
              const arr = rows.filter((r) => r.category === c);
              const Icon = c === 'removed' || c === 'deprecated' ? AlertTriangle : c === 'fixed' ? CheckCircle2 : c === 'changed' ? AlertTriangle : CheckCircle2;
              const tone = c === 'removed' || c === 'deprecated' ? 'rose' : c === 'fixed' ? 'emerald' : c === 'added' ? 'cyan' : 'amber';
              return (
                <div key={c} className={cn(
                  'flex items-center gap-2 rounded border p-2',
                  tone === 'rose' ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : tone === 'cyan' ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                )}>
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span className="capitalize">{c}</span>
                  <span className="ml-auto font-mono">{arr.length}</span>
                </div>
              );
            })}
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[10px] text-[var(--fg-secondary)]" data-testid="migration-output">
            {md}
          </pre>
        </div>
      ) : (
        <p className="text-[10px] text-[var(--fg-tertiary)]">
          Pick two versions and click <em>Generate</em> to produce a Markdown migration guide covering
          added/removed endpoints, deprecated APIs, and required action items.
        </p>
      )}
    </section>
  );
}