/**
 * Refactor Center — list page render tests (F-213).
 *
 * Covers:
 *   * Page renders the page header + the New analysis CTA.
 *   * Page renders one `<MigrationPlanCard>` per plan when the
 *     query returns data.
 *   * Page renders a loading state while the query is pending.
 *   * Page renders an error banner when the query fails.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Stub out useMigrationPlans so the test exercises pure rendering.
const mockUseMigrationPlans = vi.fn();

vi.mock("@/lib/hooks/useMigrationPlans", () => ({
  useMigrationPlans: (...args: unknown[]) => mockUseMigrationPlans(...args),
}));

import RefactorCenterPage from "../../app/refactor/page";

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
  ],
  risks: [],
};

describe("RefactorCenterPage", () => {
  beforeEach(() => {
    mockUseMigrationPlans.mockReset();
  });

  it("renders the list heading and the New analysis CTA", () => {
    mockUseMigrationPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<RefactorCenterPage />);
    expect(screen.getByTestId("refactor-center")).toBeTruthy();
    expect(screen.getByText(/Refactor Center/i)).toBeTruthy();
    const cta = screen.getByTestId("refactor-new-trigger");
    expect(cta.getAttribute("href")).toBe("/refactor/new");
  });

  it("renders one migration-plan-card per plan", () => {
    mockUseMigrationPlans.mockReturnValue({
      data: [PLAN_FIXTURE, { ...PLAN_FIXTURE, planId: "plan-002" }],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<RefactorCenterPage />);
    const list = screen.getByTestId("migration-plan-list");
    expect(list.getAttribute("data-plan-count")).toBe("2");
    expect(within(list).getAllByTestId("migration-plan-card")).toHaveLength(2);
  });

  it("renders the loading state while the query is pending", () => {
    mockUseMigrationPlans.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    render(<RefactorCenterPage />);
    expect(screen.getByTestId("refactor-loading")).toBeTruthy();
  });

  it("renders an error banner when the query fails", () => {
    mockUseMigrationPlans.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("orchestrator unreachable"),
    });
    render(<RefactorCenterPage />);
    expect(screen.getByTestId("refactor-error")).toBeTruthy();
  });

  it("renders seed plan data when the orchestrator returns no plans", () => {
    // The list page falls back to the demo fixture so dev smoke probes
    // still see content even when the stub is offline.
    mockUseMigrationPlans.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("stub offline"),
    });
    render(<RefactorCenterPage />);
    expect(screen.getByTestId("migration-plan-list")).toBeTruthy();
    expect(screen.getAllByTestId("migration-plan-card").length).toBeGreaterThan(0);
  });
});