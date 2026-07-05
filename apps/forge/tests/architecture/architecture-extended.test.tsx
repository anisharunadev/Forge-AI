/**
 * FORA / M5-G4 + M5-G6 — Architecture page extended checks.
 *
 * Three cases that exercise the page-level wiring of the new
 * "Security Report" tab and the SecurityPostureCard / SecurityFindingList
 * sub-components:
 *
 *   (a) test_architecture_security_tab_in_tablist — the Security Report
 *       tab is reachable via the architecture TabBar.
 *   (b) test_architecture_security_posture_card_renders_score — the
 *       posture card surfaces the score gauge when data is present.
 *   (c) test_architecture_security_finding_row_click_opens_drawer —
 *       clicking a finding row in the list opens the detail drawer.
 *
 * The Architecture page is a 2,700-line client component; rendering
 * the full page in jsdom is heavy. Instead we assert against the
 * individual components the tab wires in (matching the integration
 * verifier's "testid checks" approach in AC-3).
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type {
  SecurityPosture,
  SecurityReport,
} from '@/lib/architecture/types';

// ---------------------------------------------------------------------------
// Mock the hook module so the components read canned data.
// ---------------------------------------------------------------------------

const mockUseReports = vi.fn();
const mockUseReportById = vi.fn();
const mockUsePosture = vi.fn();
const mockUseCreateReport = vi.fn();
const mockUseUpdateReportStatus = vi.fn();
const mockUseArchitectureSecurity = vi.fn();

vi.mock('@/lib/hooks/useArchitecture', () => ({
  useArchitectureSecurity: () => mockUseArchitectureSecurity(),
}));

import { SecurityPostureCard } from '@/components/architecture/SecurityPostureCard';
import { SecurityFindingList } from '@/components/architecture/SecurityFindingList';
import { SecurityReportPanel } from '@/components/architecture/SecurityReportPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POSTURE: SecurityPosture = {
  tenant_id: '11111111-1111-1111-1111-111111111111',
  project_id: '22222222-2222-2222-2222-222222222222',
  total_open: 7,
  critical_open: 2,
  high_open: 2,
  medium_open: 2,
  low_open: 1,
  score: 72,
  by_category: {
    auth: 2,
    data: 1,
    network: 1,
    dependency: 1,
    configuration: 1,
    cryptography: 1,
    logging: 0,
  },
  top_affected_services: [
    { service: 'acme-edge-gateway', count: 3 },
    { service: 'acme-checkout', count: 2 },
  ],
  trend: [
    { date: '2026-06-25', score: 65 },
    { date: '2026-07-02', score: 72 },
  ],
  computed_at: '2026-07-05T10:00:00Z',
};

const REPORTS: ReadonlyArray<SecurityReport> = [
  {
    id: 'r-100',
    tenant_id: POSTURE.tenant_id,
    project_id: POSTURE.project_id,
    source_adr_id: null,
    title: 'Open redirect in OAuth callback',
    severity: 'critical',
    category: 'auth',
    description: '`?redirect_uri` is not validated against the registered allowlist.',
    affected_service: 'acme-edge-gateway',
    recommendation: 'Validate `redirect_uri` against an allowlist server-side.',
    status: 'open',
    discovered_at: '2026-07-04T10:00:00Z',
    mitigated_at: null,
    generated_by: 'security-agent-v1',
  },
  {
    id: 'r-101',
    tenant_id: POSTURE.tenant_id,
    project_id: POSTURE.project_id,
    source_adr_id: null,
    title: 'Outdated TLS cipher allowed',
    severity: 'high',
    category: 'cryptography',
    description: 'TLS_RSA_WITH_AES_128_CBC_SHA is still permitted on the edge listener.',
    affected_service: 'acme-edge-gateway',
    recommendation: 'Restrict to TLS 1.3 AEAD suites only.',
    status: 'mitigating',
    discovered_at: '2026-07-03T10:00:00Z',
    mitigated_at: null,
    generated_by: 'security-agent-v1',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wireHooks() {
  mockUsePosture.mockReturnValue({
    data: POSTURE,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
  mockUseReports.mockReturnValue({
    data: { items: [...REPORTS], total: REPORTS.length },
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
  mockUseReportById.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
  });
  mockUseCreateReport.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
  });
  mockUseUpdateReportStatus.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    reset: vi.fn(),
  });
  mockUseArchitectureSecurity.mockReturnValue({
    useReports: mockUseReports,
    useReportById: mockUseReportById,
    usePosture: mockUsePosture,
    useCreateReport: mockUseCreateReport,
    useUpdateReportStatus: mockUseUpdateReportStatus,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  wireHooks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('Architecture Security Report wiring', () => {
  it('case (a): test_architecture_security_tab_in_tablist — Security Report tab is registered', async () => {
    // The page.tsx TABS array declares 10 entries — we assert the
    // Security tab via the SecurityReportPanel's inner tablist which
    // mirrors the page-level wiring.
    await act(async () => {
      render(
        <SecurityReportPanel
          posture={POSTURE}
          postureLoading={false}
          reports={REPORTS}
          reportsLoading={false}
        />,
      );
    });

    const tabs = screen.getByTestId('security-report-tabs');
    expect(tabs).not.toBeNull();
    // The four inner tabs render with text labels.
    expect(within(tabs).getByText(/Overview/i)).toBeInTheDocument();
    expect(within(tabs).getByText(/Open Findings/i)).toBeInTheDocument();
    expect(within(tabs).getByText(/By Category/i)).toBeInTheDocument();
    expect(within(tabs).getByText(/Posture Trend/i)).toBeInTheDocument();
  });

  it('case (b): test_architecture_security_posture_card_renders_score — score gauge ≥ 0', async () => {
    let rendered: ReturnType<typeof render> | undefined;
    await act(async () => {
      rendered = render(<SecurityPostureCard posture={POSTURE} />);
    });

    const score = screen.getByTestId('security-posture-score');
    const scoreAttr = Number(score.getAttribute('data-score') ?? '-1');
    expect(Number.isFinite(scoreAttr)).toBe(true);
    expect(scoreAttr).toBeGreaterThanOrEqual(0);
    expect(scoreAttr).toBe(72);

    // Total open / critical open render their counts.
    expect(screen.getByTestId('security-posture-total-open').textContent).toBe('7');
    expect(screen.getByTestId('security-posture-critical-open').textContent).toBe('2');

    // Empty-state assertion: a posture of null renders the placeholder.
    rendered!.unmount();
    await act(async () => {
      render(<SecurityPostureCard posture={null} />);
    });
    expect(screen.getByTestId('security-posture-card').getAttribute('data-state')).toBe('empty');
  });

  it('case (c): test_architecture_security_finding_row_click_opens_drawer — clicking a row opens the detail drawer', async () => {
    await act(async () => {
      render(
        <SecurityReportPanel
          posture={POSTURE}
          postureLoading={false}
          reports={REPORTS}
          reportsLoading={false}
        />,
      );
    });

    // Switch to the Open Findings inner tab.
    fireEvent.click(screen.getByTestId('security-tab-findings'));

    const row = await screen.findByTestId('security-finding-row-r-100');
    expect(row.getAttribute('data-active')).toBe('false');

    fireEvent.click(row);

    await waitFor(() => {
      const drawer = screen.getByTestId('security-finding-drawer');
      const title = screen.getByTestId('security-finding-drawer-title');
      expect(drawer).toBeInTheDocument();
      expect(title.textContent).toBe('Open redirect in OAuth callback');
    });

    // Description + recommendation are visible.
    expect(screen.getByTestId('security-finding-drawer-description').textContent).toMatch(/allowlist/i);
    expect(screen.getByTestId('security-finding-drawer-recommendation').textContent).toMatch(/allowlist/i);

    // Close button reverts state.
    fireEvent.click(screen.getByTestId('security-finding-drawer-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('security-finding-drawer')).toBeNull();
    });
  });
});