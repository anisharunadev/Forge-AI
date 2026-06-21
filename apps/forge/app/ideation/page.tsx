'use client';

import * as React from 'react';
import { Lightbulb } from 'lucide-react';

import { AdminShell } from '@/components/admin/AdminShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IdeaList } from '@/components/ideation/IdeaList';
import { IdeaDetailPanel } from '@/components/ideation/IdeaDetailPanel';
import { IdeaIntakeDialog } from '@/components/ideation/IdeaIntakeDialog';
import { RoadmapView } from '@/components/ideation/RoadmapView';
import { PRDList, PRDViewer } from '@/components/ideation/PRDViewer';
import { ArchPreviewGraph } from '@/components/ideation/ArchPreviewGraph';
import { ApprovalQueuePanel } from '@/components/ideation/ApprovalQueuePanel';
import { useApiData } from '@/hooks/use-api-data';
import {
  type Approval,
  type ArchPreview,
  type Idea,
  type IdeaStatus,
  type PRD,
  type RoadmapItem,
} from '@/lib/ideation/data';

const STATUS_OPTIONS: ReadonlyArray<IdeaStatus | 'all'> = [
  'all',
  'intake',
  'scoring',
  'discovery',
  'prd',
  'approved',
  'rejected',
  'shipped',
];

export default function IdeationCenterPage() {
  const [statusFilter, setStatusFilter] = React.useState<IdeaStatus | 'all'>(
    'all',
  );
  const [selected, setSelected] = React.useState<Idea | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [selectedPRD, setSelectedPRD] = React.useState<PRD | null>(null);

  const ideasRes = useApiData<ReadonlyArray<Idea>>('/v1/ideation/ideas');
  const roadmapRes = useApiData<ReadonlyArray<RoadmapItem>>('/v1/ideation/roadmap');
  const prdsRes = useApiData<ReadonlyArray<PRD>>('/v1/ideation/prds');
  const previewsRes = useApiData<ReadonlyArray<ArchPreview>>('/v1/ideation/arch-previews');
  const approvalsRes = useApiData<ReadonlyArray<Approval>>('/v1/ideation/approvals');

  const ideas: ReadonlyArray<Idea> = ideasRes.data ?? [];
  const roadmap: ReadonlyArray<RoadmapItem> = roadmapRes.data ?? [];
  const prds: ReadonlyArray<PRD> = prdsRes.data ?? [];
  const previews: ReadonlyArray<ArchPreview> = previewsRes.data ?? [];

  const [approvals, setApprovals] = React.useState<ReadonlyArray<Approval>>([]);

  React.useEffect(() => {
    if (approvals.length === 0 && approvalsRes.data && approvalsRes.data.length > 0) {
      setApprovals(approvalsRes.data);
    }
  }, [approvalsRes.data, approvals.length]);

  const filtered = React.useMemo(
    () =>
      statusFilter === 'all'
        ? ideas
        : ideas.filter((i) => i.status === statusFilter),
    [ideas, statusFilter],
  );

  const handleSelect = (idea: Idea) => {
    setSelected(idea);
    setDetailOpen(true);
  };

  const handleDecide = (
    approval: Approval,
    decision: 'approve' | 'reject',
  ) => {
    setApprovals((curr) =>
      curr.map((a) =>
        a.id === approval.id ? { ...a, status: decision === 'approve' ? 'approved' : 'rejected' } : a,
      ),
    );
  };

  const activePRD = selectedPRD ?? prds[0] ?? null;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6" data-testid="ideation-center">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Center
          </p>
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
              Ideation Center
            </h1>
            <IdeaIntakeDialog
              onCreate={(input) => {
                // eslint-disable-next-line no-console
                console.info('[ideation] submit', input);
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Capture ideas, score them, plan the roadmap, draft PRDs, and
            preview architecture before any code is written.
          </p>
        </header>

        <Tabs defaultValue="ideas" className="w-full">
          <TabsList aria-label="Ideation Center sections">
            <TabsTrigger value="ideas" data-testid="tab-ideas">
              Ideas
            </TabsTrigger>
            <TabsTrigger value="roadmap" data-testid="tab-roadmap">
              Roadmap
            </TabsTrigger>
            <TabsTrigger value="prds" data-testid="tab-prds">
              PRDs
            </TabsTrigger>
            <TabsTrigger value="arch" data-testid="tab-arch">
              Architecture Previews
            </TabsTrigger>
            <TabsTrigger value="approvals" data-testid="tab-approvals">
              My Approvals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ideas" className="space-y-4">
            <div className="flex items-center justify-end gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v: string) =>
                  setStatusFilter(v as IdeaStatus | 'all')
                }
              >
                <SelectTrigger className="w-40" data-testid="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === 'all' ? 'All statuses' : s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <IdeaList
              ideas={filtered}
              onSelect={handleSelect}
              emptyMessage="No ideas match the current filter."
            />
          </TabsContent>

          <TabsContent value="roadmap">
            <RoadmapView items={roadmap} />
          </TabsContent>

          <TabsContent value="prds" className="space-y-4">
            <PRDList
              prds={prds}
              selectedId={activePRD?.id}
              onSelect={setSelectedPRD}
            />
            {activePRD ? <PRDViewer prd={activePRD} /> : null}
          </TabsContent>

          <TabsContent value="arch" className="space-y-4">
            {previews.map((p) => (
              <div key={p.id} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{p.title}</h3>
                <p className="text-xs text-forge-300">{p.description}</p>
                <ArchPreviewGraph preview={p} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalQueuePanel
              approvals={approvals}
              onDecide={handleDecide}
            />
          </TabsContent>
        </Tabs>

        <IdeaDetailPanel
          idea={selected}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      </div>
    </AdminShell>
  );
}
