/**
 * Refactor Center — plan detail render tests (F-213).
 *
 * Covers:
 *   * Phased view renders one `<phase-timeline-item>` per phase.
 *   * Risk register renders one `<risk-register-row>` per risk,
 *     linked back to the phase title.
 *   * PushToJiraButton is wired with the plan id.
 *   * Loading + empty states render based on the query state.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const mockUseMigrationPlan = vi.fn();
const mockUsePushMigrationPlanToJira = vi.fn();

vi.mock("@/lib/hooks/useMigrationPlans", () => ({
  useMigrationPlan: (...args: unknown[]) => mockUseMigrationPlan(...args),
  usePushMigrationPlanToJira: (...args: unknown[]) =>
    mockUsePushMigrationPlanToJira(...args),
}));

import MigrationPlanDetailPage from "../../../app/refactor/[plan_id]/page";

const PLAN_FIXTURE = {
  planId: "plan-001",
  projectId: "project-forge-demo",
  tenantId: "00000000-0000-4000-8000-000000000ace",
  source: "postgres-14",
  target: "postgres-17",
  title: "Postgres 14 → 17 cutover",
  summary: "Migrate the OLTP cluster.",
  createdAt: "2026-06-15T09:00:00Z",
  updatedAt: "2026-06-20T17:20:00Z",
  status: "in_progress" as const,
  phases: [
    {
      id: "phase-001-1",
      index: 1,
      title: "Compatibility scan",
      summary: "Run pg_upgrade --check.",
      effort: "S" as const,
      estimateHours: 4,
      status: "complete" as const,
      tasks: ["Run check tool"],
    },
    {
      id: "phase-001-2",
      index: 2,
      title: "Replica provisioning",
      summary: "Stand up a fresh PG17 cluster.",
      effort: "M" as const,
      estimateHours: 16,
      status: "in_progress" as const,
      tasks: ["Provision nodes"],
    },
  ],
  risks: [
    {
      id: "risk-001-1",
      phaseId: "phase-001-2",
      title: "Replication lag spikes",
      severity: "high" as const,
      mitigation: "Throttle writes during snapshot.",
      owner: "Diego Romero",
    },
  ],
};

/**
 * Test harness that resolves the params Promise inline so we can render
 * a client component that consumes `React.use(params)`.
 */
function renderDetail(planId: string) {
  return render(
    <MigrationPlanDetailPage params={Promise.resolve({ plan_id: planId })} />,
  );
}

describe("MigrationPlanDetailPage", () => {
  beforeEach(() => {
    mockUseMigrationPlan.mockReset();
    mockUsePushMigrationPlanToJira.mockReset();
    mockUsePushMigrationPlanToJira.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      data: undefined,
      error: null,
      reset: vi.fn(),
    });
  });

  it("renders the phased view with one row per phase", async () => {
    mockUseMigrationPlan.mockReturnValue({
      data: PLAN_FIXTURE,
      isLoading: false,
      isError: false,
      error: null,
    });
    await act(async () => {
      renderDetail("plan-001");
      await Promise.resolve();
    });

    const timeline = screen.getByTestId("phase-timeline");
    expect(timeline.getAttribute("data-phase-count")).toBe("2");
    expect(within(timeline).getAllByTestId("phase-timeline-item")).toHaveLength(2);
  });

  it("renders the status pill + effort badge per phase", async () => {
    mockUseMigrationPlan.mockReturnValue({
      data: PLAN_FIXTURE,
      isLoading: false,
      isError: false,
      error: null,
    });
    await act(async () => {
      renderDetail("plan-001");
      await Promise.resolve();
    });

    const phaseRows = screen.getAllByTestId("phase-timeline-item");
    expect(phaseRows[0]?.getAttribute("data-phase-status")).toBe("complete");
    expect(phaseRows[1]?.getAttribute("data-phase-status")).toBe("in_progress");

    const efforts = screen.getAllByTestId("effort-estimate");
    expect(efforts.map((e) => e.getAttribute("data-effort"))).toEqual(["S", "M"]);
  });

  it("renders the risk register with linked phase titles", async () => {
    mockUseMigrationPlan.mockReturnValue({
      data: PLAN_FIXTURE,
      isLoading: false,
      isError: false,
      error: null,
    });
    await act(async () => {
      renderDetail("plan-001");
      await Promise.resolve();
    });

    const register = screen.getByTestId("risk-register");
    expect(register.getAttribute("data-risk-count")).toBe("1");
    const row = screen.getByTestId("risk-register-row");
    expect(row.getAttribute("data-phase-id")).toBe("phase-001-2");
    expect(row.textContent).toContain("Replication lag spikes");
    expect(row.textContent).toContain("Phase 2");
  });

  it("exposes the PushToJiraButton with the plan id", async () => {
    mockUseMigrationPlan.mockReturnValue({
      data: PLAN_FIXTURE,
      isLoading: false,
      isError: false,
      error: null,
    });
    await act(async () => {
      renderDetail("plan-001");
      await Promise.resolve();
    });

    const button = screen.getByTestId("push-to-jira-button");
    expect(button.getAttribute("data-plan-id")).toBe("plan-001");
    expect(button.textContent).toContain("Push to Jira");
  });

  it("renders the loading state while the query is pending", async () => {
    mockUseMigrationPlan.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    await act(async () => {
      renderDetail("plan-001");
      await Promise.resolve();
    });
    expect(screen.getByTestId("refactor-plan-loading")).toBeTruthy();
  });
});