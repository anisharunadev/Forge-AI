'use client';

/**
 * Ideation Center — Step 28 ("Continuous Context Orchestration" hub).
 *
 * Replaces the Step 5 page with a 9-tab hub:
 *   Pipeline (default) / Ideas / Roadmap / PRDs / Architecture Previews /
 *   My Approvals / Sources / Destinations / Market Signals / Customer Voice.
 *
 * Hero band surfaces the daily-ingest status, the new CaptureModal, and a
 * 3-dot menu. Keyboard shortcuts (⌘N, ⌘⇧V, ⌘⇧S, ⌘K, ⌘⇧P, ⌘/) are wired
 * via `useIdeationHotkeys`.
 *
 * Step 5 idea data model is preserved — the only Step 28 enrichment lives
 * in `lib/ideation/pipeline-data.ts` and is keyed by idea id.
 */

import * as React from 'react';
import {
  Bell,
  HelpCircle,
  Keyboard,
  Lightbulb,
  MoreHorizontal,
  Plus,
  Settings,
} from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import type { IdeationView } from '@/components/ideation/IdeationBoard';
import { IdeaDetailPanel } from '@/components/ideation/IdeaDetailPanel';
import { IdeationIdeasPanel } from '@/components/ideation/IdeationIdeasPanel';
import { IdeationRoadmapPanel } from '@/components/ideation/IdeationRoadmapPanel';
import { IdeationPRDPanel } from '@/components/ideation/IdeationPRDPanel';
import { IdeationArchPreviewPanel } from '@/components/ideation/IdeationArchPreviewPanel';
import { IdeationApprovalsPanel } from '@/components/ideation/IdeationApprovalsPanel';
import { IngestIndicator } from '@/components/ideation/IngestIndicator';
import { PipelineView } from '@/components/ideation/PipelineView';
import { SourcesTab } from '@/components/ideation/SourcesTab';
import { DestinationsTab } from '@/components/ideation/DestinationsTab';
import { MarketSignalsTab } from '@/components/ideation/MarketSignalsTab';
import { AgentLaunchButton } from '@/components/step45/AgentLaunchButton';
import { CustomerVoiceTab } from '@/components/ideation/CustomerVoiceTab';
import { CaptureModal } from '@/components/ideation/CaptureModal';
import { OneClickPipelineDrawer } from '@/components/ideation/OneClickPipelineDrawer';

import { useIdeationIngestStatus } from '@/lib/hooks/useIdeationIngestStatus';
import { useIdeationHotkeys, type HotkeyId } from '@/lib/hooks/useIdeationHotkeys';
import { useIdeasAdapter, useApprovalsAdapter } from '@/lib/hooks/useIdeationAdapters';
import { PageHeader } from '@/components/shell';
import { toast } from 'sonner';
import type { Idea } from '@/lib/ideation/data';

// ---------------------------------------------------------------------------
// Tab enumeration — keeps the badge counts next to the labels.
// ---------------------------------------------------------------------------

type TabId =
  | 'pipeline'
  | 'ideas'
  | 'roadmap'
  | 'prds'
  | 'arch'
  | 'approvals'
  | 'sources'
  | 'destinations'
  | 'market'
  | 'voice';

const TABS: ReadonlyArray<{ id: TabId; label: string; testId: string }> = [
  { id: 'pipeline', label: 'Pipeline', testId: 'tab-pipeline' },
  { id: 'ideas', label: 'Ideas', testId: 'tab-ideas' },
  { id: 'roadmap', label: 'Roadmap', testId: 'tab-roadmap' },
  { id: 'prds', label: 'PRDs', testId: 'tab-prds' },
  { id: 'arch', label: 'Architecture Previews', testId: 'tab-arch' },
  { id: 'approvals', label: 'My Approvals', testId: 'tab-approvals' },
  { id: 'sources', label: 'Sources', testId: 'tab-sources' },
  { id: 'destinations', label: 'Destinations', testId: 'tab-destinations' },
  { id: 'market', label: 'Market Signals', testId: 'tab-market' },
  { id: 'voice', label: 'Customer Voice', testId: 'tab-voice' },
];

export default function IdeationCenterPage() {
  const [view, setView] = React.useState<IdeationView>('kanban');
  const [selected, setSelected] = React.useState<Idea | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [captureDefaultTitle, setCaptureDefaultTitle] = React.useState('');
  const [captureDefaultDescription, setCaptureDefaultDescription] = React.useState('');
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [pipelineIdea, setPipelineIdea] = React.useState<Idea | null>(null);
  const [pipelineDrawerOpen, setPipelineDrawerOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Step-57 Zone 6 — wire the page to the canonical TanStack Query
  // hooks in `lib/hooks/useIdeation.ts` via the legacy-shape adapters
  // (`lib/hooks/useIdeationAdapters.ts`). The adapter hooks own the
  // query state (loading / error / refetch) — the page-level state
  // here only tracks counts for the tab badges.
  const ideasAdapter = useIdeasAdapter();
  const ideas: ReadonlyArray<Idea> = ideasAdapter.data;
  // Pull a lightweight approvals count for the tab badge. The full
  // approval data lives in `IdeationApprovalsPanel`; the page only
  // needs the length.
  const approvalsAdapter = useApprovalsAdapter();
  const approvalsCount = approvalsAdapter.data.length;

  const ingestStatusRes = useIdeationIngestStatus();
  const ingestStatus = ingestStatusRes.data?.status ?? 'never';
  const ingestIdeasCreatedToday = ingestStatusRes.data?.ideas_created_today ?? 0;
  const ingestLastRunAt = ingestStatusRes.data?.last_run_at ?? null;

  const handleSelect = (idea: Idea) => {
    setSelected(idea);
    setDetailOpen(true);
  };

  const handleGeneratePreview = () => {
    // eslint-disable-next-line no-console
    console.info('[ideation] generate preview — wired to architecture pipeline in a follow-up');
  };

  const handleAddNew = (column: string) => {
    setCaptureDefaultTitle('');
    setCaptureDefaultDescription('');
    setCaptureOpen(true);
    // eslint-disable-next-line no-console
    console.info('[ideation] add new from column', column);
  };

  const handleMoveQuarter = (itemId: string, toQuarter: string) => {
    // eslint-disable-next-line no-console
    console.info('[ideation:roadmap] move-quarter', { itemId, toQuarter });
  };

  const handleSendToPipeline = (idea: Idea) => {
    setPipelineIdea(idea);
    setPipelineDrawerOpen(true);
  };

  const openNewIdea = () => {
    setCaptureDefaultTitle('');
    setCaptureDefaultDescription('');
    setCaptureOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Hotkeys — single source of truth for ⌘N / ⌘⇧V / ⌘⇧S / ⌘K / ⌘⇧P / ⌘/.
  // ---------------------------------------------------------------------------

  const handleHotkey = React.useCallback((id: HotkeyId) => {
    switch (id) {
      case 'new-idea':
        openNewIdea();
        break;
      case 'voice':
        setCaptureDefaultTitle('');
        setCaptureDefaultDescription('');
        setCaptureOpen(true);
        toast.info('Voice capture ready', {
          description: 'Press the mic to start, or close this dialog.',
        });
        break;
      case 'screen':
        setCaptureDefaultTitle('');
        setCaptureDefaultDescription('');
        setCaptureOpen(true);
        toast.info('Screen capture ready', {
          description: 'Press record to start (up to 2 min).',
        });
        break;
      case 'search':
        toast.info('Search palette — opens in a follow-up.');
        break;
      case 'process-now':
        toast.success('Triggered manual ingest + reasoning cycle', {
          description: 'See the Pipeline tab for live status.',
        });
        break;
      case 'shortcuts':
        setShortcutsOpen(true);
        break;
    }
  }, []);

  useIdeationHotkeys({ onHotkey: handleHotkey });

  // Step-57 Zone 6 — counts for badge chips on Ideas / Approvals.
  // PRD count is 0 for now because the canonical PRD list endpoint
  // isn't wired in the adapter yet (PRD is per-idea in the wire
  // shape). Flip this to the new list endpoint when it lands.
  const ideaCount = ideas.length;
  const prdCount = 0;
  // `approvalsCount` is computed above from `approvalsAdapter.data.length`
  // — keep the variable name for the badge lookup below.

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="ideation-center">
        <PageHeader
          eyebrow="Center"
          title="Ideation Center"
          icon={<Lightbulb className="h-4 w-4" aria-hidden="true" />}
          description="Capture ideas, score them, plan the roadmap, draft PRDs, preview architecture, and sync to Jira + Confluence + ai agent — all from one place."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/* Step 45 — PM Agent entry point */}
              <AgentLaunchButton
                agent="pm"
                onLaunch={async () => {
                  toast.info('PM Agent invoked from Ideation Center.');
                }}
              />
              <IngestIndicator
                status={ingestStatus}
                ideas_created_today={ingestIdeasCreatedToday}
                last_run_at={ingestLastRunAt}
              />
              <Button
                type="button"
                onClick={openNewIdea}
                data-testid="ideation-new-idea"
                className="bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Idea
              </Button>
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="More menu"
                  data-testid="ideation-more-menu"
                  className="border-[var(--border-default)] text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
                {menuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-56 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        toast.info('Pipeline settings — opens in a follow-up.');
                      }}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      Pipeline settings
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        toast.info('Export queued — bundles ideas + PRDs into a zip.');
                      }}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                    >
                      Export all
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShortcutsOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--bg-inset)] hover:text-[var(--fg-primary)]"
                    >
                      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      Help
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          }
        />

        <Tabs defaultValue="pipeline" className="w-full">
          <div className="overflow-x-auto pb-1 thin-scrollbar">
            <TabsList
              aria-label="Ideation Center sections"
              className="inline-flex h-9 items-center justify-start gap-1 rounded-lg bg-[var(--bg-surface)] p-1 text-[var(--fg-secondary)]"
            >
              {TABS.map((t) => {
                const badge =
                  t.id === 'ideas' ? ideaCount
                    : t.id === 'prds' ? prdCount
                      : t.id === 'approvals' ? approvalsCount
                        : null;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    data-testid={t.testId}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--fg-primary)] data-[state=active]:shadow"
                  >
                    {t.label}
                    {badge !== null && badge > 0 ? (
                      <span
                        className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--bg-inset)] px-1 font-mono text-[10px] text-[var(--fg-tertiary)]"
                        data-testid={`tab-badge-${t.id}`}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <TabsContent value="pipeline" className="mt-4">
            <PipelineView
              onAddSource={() => toast.info('Source picker — opens in a follow-up.')}
              onAddDestination={() => toast.info('Destination picker — opens in a follow-up.')}
              onOpenSource={() => toast.info('Source detail — opens in a follow-up.')}
              onOpenDestination={() => toast.info('Destination detail — opens in a follow-up.')}
              onProcessNow={() => toast.success('Manual ingest cycle triggered.')}
            />
          </TabsContent>

          <TabsContent value="ideas" className="mt-4">
            <IdeationIdeasPanel
              view={view}
              onViewChange={setView}
              onSelect={handleSelect}
              onAddNew={handleAddNew}
              onMenu={() => {
                // eslint-disable-next-line no-console
                console.info('[ideation] idea menu — wired in a follow-up.');
              }}
            />
          </TabsContent>

          <TabsContent value="roadmap" className="mt-4">
            <IdeationRoadmapPanel onMoveQuarter={handleMoveQuarter} />
          </TabsContent>

          <TabsContent value="prds" className="mt-4 space-y-4">
            <IdeationPRDPanel
              ideas={ideas}
              onSelect={(prd) => {
                // eslint-disable-next-line no-console
                console.info('[ideation] open prd', { id: prd.id });
              }}
              onGenerate={handleGeneratePreview}
            />
          </TabsContent>

          <TabsContent value="arch" className="mt-4">
            <IdeationArchPreviewPanel onGenerate={handleGeneratePreview} />
          </TabsContent>

          <TabsContent value="approvals" className="mt-4">
            <IdeationApprovalsPanel
              onOpen={(a) => {
                // eslint-disable-next-line no-console
                console.info('[ideation] open approval', { id: a.id });
              }}
            />
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <SourcesTab />
          </TabsContent>

          <TabsContent value="destinations" className="mt-4">
            <DestinationsTab />
          </TabsContent>

          <TabsContent value="market" className="mt-4">
            <MarketSignalsTab
              onGenerateIdea={() => {
                setCaptureDefaultTitle('');
                setCaptureDefaultDescription('');
                setCaptureOpen(true);
              }}
            />
          </TabsContent>

          <TabsContent value="voice" className="mt-4">
            <CustomerVoiceTab
              onConvertToIdea={() => {
                setCaptureDefaultTitle('');
                setCaptureDefaultDescription('');
                setCaptureOpen(true);
              }}
            />
          </TabsContent>
        </Tabs>

        <IdeaDetailPanel
          idea={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          onSendToPipeline={handleSendToPipeline}
        />

        <OneClickPipelineDrawer
          idea={pipelineIdea}
          open={pipelineDrawerOpen}
          onOpenChange={setPipelineDrawerOpen}
        />

        <CaptureModal
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          onCreate={(input) => {
            // eslint-disable-next-line no-console
            console.info('[ideation:capture] submit', input);
          }}
          {...(captureDefaultTitle ? { defaultTitle: captureDefaultTitle } : {})}
          {...(captureDefaultDescription ? { defaultDescription: captureDefaultDescription } : {})}
        />

        <Sheet open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
          <SheetContent
            side="right"
            className="w-full sm:max-w-sm"
            data-testid="ideation-shortcuts"
          >
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
                Keyboard shortcuts
              </SheetTitle>
              <SheetDescription>
                Press <kbd className="rounded bg-[var(--bg-inset)] px-1 font-mono text-[10px]">⌘ /</kbd> any time to open this sheet.
              </SheetDescription>
            </SheetHeader>
            <ul className="mt-4 space-y-2 text-[12px]">
              {[
                { keys: '⌘ N', label: 'New idea' },
                { keys: '⌘ ⇧ V', label: 'Voice capture' },
                { keys: '⌘ ⇧ S', label: 'Screen capture' },
                { keys: '⌘ K', label: 'Search' },
                { keys: '⌘ ⇧ P', label: 'Process now' },
                { keys: '⌘ /', label: 'Show shortcuts' },
              ].map((row) => (
                <li key={row.keys} className="flex items-center justify-between rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-2 py-1.5">
                  <span className="text-[var(--fg-secondary)]">{row.label}</span>
                  <kbd className="rounded bg-[var(--bg-inset)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--fg-primary)]">
                    {row.keys}
                  </kbd>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--fg-tertiary)]">
              <Bell className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
              Tip — non-Mac users can substitute <kbd className="font-mono">Ctrl</kbd> for <kbd className="font-mono">⌘</kbd>.
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AdminShell>
  );
}