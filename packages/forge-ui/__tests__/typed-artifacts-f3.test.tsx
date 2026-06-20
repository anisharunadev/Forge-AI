import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { ApiContractRenderer } from "../src/typed-artifacts/api-contract";
import { PatchRenderer } from "../src/typed-artifacts/patch";
import { TestReportRenderer } from "../src/typed-artifacts/test-report";
import { DeploymentPlanRenderer } from "../src/typed-artifacts/deployment-plan";
import { AuditEntryRenderer } from "../src/typed-artifacts/audit-entry";
import { ApprovalRequestRenderer } from "../src/typed-artifacts/approval-request";

describe("ApiContractRenderer", () => {
  it("renders name, version, format badge, and endpoint summary", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <ApiContractRenderer
        artifact={{
          id: "api-1",
          name: "Forge API",
          version: "1.2.0",
          format: "openapi",
          endpoints: [
            { id: "e1", method: "GET", path: "/issues", summary: "List issues" },
            { id: "e2", method: "POST", path: "/issues", summary: "Create issue" },
          ],
        }}
      />,
    );
    expect(getByText("Forge API")).toBeInTheDocument();
    expect(getByText("1.2.0")).toBeInTheDocument();
    expect(getByLabelText("Format: openapi")).toBeInTheDocument();
    expect(getByText(/2 endpoints/)).toBeInTheDocument();
  });

  it("detail variant lists each endpoint with method + path", () => {
    const { getByText } = renderWithProviders(
      <ApiContractRenderer
        artifact={{
          id: "api-2",
          name: "Forge API",
          version: "1.0.0",
          format: "openapi",
          endpoints: [{ id: "e1", method: "GET", path: "/health" }],
        }}
        variant="detail"
      />,
    );
    expect(getByText("GET")).toBeInTheDocument();
    expect(getByText("/health")).toBeInTheDocument();
  });

  it("diff variant shows added / removed / changed counts", () => {
    const { getByText } = renderWithProviders(
      <ApiContractRenderer
        artifact={{
          id: "api-3",
          name: "Forge API",
          version: "2.0.0",
          format: "openapi",
          endpoints: [
            { id: "e1", method: "GET", path: "/v2/issues" },
            { id: "e2", method: "POST", path: "/issues" },
          ],
          previousVersion: {
            version: "1.0.0",
            endpoints: [
              { id: "e1", method: "GET", path: "/issues" },
              { id: "e3", method: "DELETE", path: "/issues/:id" },
            ],
          },
        }}
        variant="diff"
      />,
    );
    expect(getByText(/\+ Added \(1\)/)).toBeInTheDocument();
    expect(getByText(/− Removed \(1\)/)).toBeInTheDocument();
    expect(getByText(/~ Changed \(1\)/)).toBeInTheDocument();
  });
});

describe("PatchRenderer", () => {
  it("shows additions / deletions / file count in summary variant", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <PatchRenderer
        artifact={{
          id: "p-1",
          title: "Add typed-artifact renderers",
          filesChanged: 6,
          additions: 412,
          deletions: 23,
          summary: "Six renderers + helpers + tests.",
        }}
      />,
    );
    expect(getByText("Add typed-artifact renderers")).toBeInTheDocument();
    expect(getByLabelText("412 additions")).toBeInTheDocument();
    expect(getByLabelText("23 deletions")).toBeInTheDocument();
    expect(getByText("6 files")).toBeInTheDocument();
  });

  it("pr-link variant renders PR badges + review state", () => {
    const { getByText } = renderWithProviders(
      <PatchRenderer
        artifact={{
          id: "p-2",
          title: "Patch",
          filesChanged: 1,
          additions: 1,
          deletions: 1,
          linkedPrs: [
            {
              id: "101",
              url: "https://example/pr/101",
              state: "open",
              reviewState: "approved",
            },
          ],
        }}
        variant="pr-link"
      />,
    );
    expect(getByText("PR-101")).toBeInTheDocument();
    expect(getByText("open")).toBeInTheDocument();
    expect(getByText("approved")).toBeInTheDocument();
  });

  it("diff variant renders per-file hunks with +/- colors", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <PatchRenderer
        artifact={{
          id: "p-3",
          title: "Patch with hunks",
          filesChanged: 1,
          additions: 2,
          deletions: 1,
          files: [
            {
              path: "src/foo.ts",
              additions: 2,
              deletions: 1,
              hunks: [
                { kind: "context", text: "function foo() {" },
                { kind: "deletion", text: "  return 1" },
                { kind: "addition", text: "  return 2" },
              ],
            },
          ],
        }}
        variant="diff"
      />,
    );
    expect(getByText("src/foo.ts")).toBeInTheDocument();
    expect(getByLabelText("Hunks for src/foo.ts")).toBeInTheDocument();
  });
});

describe("TestReportRenderer", () => {
  it("summary-card shows tier badge + counts + pass rate", () => {
    const { getByText, container } = renderWithProviders(
      <TestReportRenderer
        artifact={{
          id: "tr-1",
          tier: "unit",
          total: 100,
          passed: 96,
          failed: 2,
          skipped: 2,
          durationMs: 4300,
        }}
      />,
    );
    expect(getByText("Test Report — unit")).toBeInTheDocument();
    // "96% pass rate" is rendered as multiple text nodes; assert via container.
    expect(container.textContent).toContain("pass rate");
    expect(container.textContent).toContain("96%");
    expect(getByText("2 failed")).toBeInTheDocument();
  });

  it("detail-panel lists failing tests", () => {
    const { getByText } = renderWithProviders(
      <TestReportRenderer
        artifact={{
          id: "tr-2",
          tier: "integration",
          total: 10,
          passed: 9,
          failed: 1,
          skipped: 0,
          durationMs: 1200,
          failingTests: [
            {
              id: "t-1",
              name: "should create issue mirror",
              status: "failed",
              durationMs: 230,
              failureMessage: "Expected 201, got 409",
            },
          ],
        }}
        variant="detail-panel"
      />,
    );
    expect(getByText("should create issue mirror")).toBeInTheDocument();
    expect(getByText("Expected 201, got 409")).toBeInTheDocument();
  });

  it("coverage-map renders one row per module with a percentage", () => {
    const { getByText } = renderWithProviders(
      <TestReportRenderer
        artifact={{
          id: "tr-3",
          tier: "unit",
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          durationMs: 0,
          coverage: [
            { modulePath: "src/api", coveragePct: 92.1 },
            { modulePath: "src/cli", coveragePct: 47.0 },
          ],
        }}
        variant="coverage-map"
      />,
    );
    expect(getByText("src/api")).toBeInTheDocument();
    expect(getByText("92.1%")).toBeInTheDocument();
    expect(getByText("src/cli")).toBeInTheDocument();
    expect(getByText("47.0%")).toBeInTheDocument();
  });
});

describe("DeploymentPlanRenderer", () => {
  it("summary-card shows target env, version, strategy, and approval state", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <DeploymentPlanRenderer
        artifact={{
          id: "d-1",
          title: "Forge v0.2 deploy",
          targetEnv: "prod",
          version: "0.2.0",
          strategy: "blue-green",
          approvalState: "approved",
          deployer: "ci-bot",
        }}
      />,
    );
    expect(getByText("Forge v0.2 deploy")).toBeInTheDocument();
    expect(getByText(/prod.*0\.2\.0.*blue-green/)).toBeInTheDocument();
    expect(getByLabelText("Approval: approved")).toBeInTheDocument();
  });

  it("run-log-table variant renders per-step status", () => {
    const { getByText } = renderWithProviders(
      <DeploymentPlanRenderer
        artifact={{
          id: "d-2",
          title: "Deploy",
          targetEnv: "staging",
          version: "0.2.0",
          strategy: "rolling",
          approvalState: "pending",
          steps: [
            { id: "s1", title: "Build", status: "succeeded", startedAt: "t0", finishedAt: "t1" },
            { id: "s2", title: "Migrate", status: "running", startedAt: "t2" },
          ],
        }}
        variant="run-log-table"
      />,
    );
    expect(getByText("Build")).toBeInTheDocument();
    expect(getByText("succeeded")).toBeInTheDocument();
    expect(getByText("Migrate")).toBeInTheDocument();
    expect(getByText("running")).toBeInTheDocument();
  });

  it("detail-panel surfaces rollback plan + last rollback record", () => {
    const { getByText } = renderWithProviders(
      <DeploymentPlanRenderer
        artifact={{
          id: "d-3",
          title: "Deploy",
          targetEnv: "prod",
          version: "0.2.0",
          strategy: "canary",
          approvalState: "rolled-back",
          rollbackPlan: "Re-route traffic to previous blue.",
          lastRollback: {
            id: "rb-1",
            reason: "5xx rate spike",
            triggeredAt: "2026-06-19T10:00Z",
            triggeredBy: "ci-bot",
          },
        }}
        variant="detail-panel"
      />,
    );
    expect(getByText("Re-route traffic to previous blue.")).toBeInTheDocument();
    expect(getByText("5xx rate spike")).toBeInTheDocument();
  });
});

describe("AuditEntryRenderer", () => {
  it("row variant renders timestamp, actor kind, tool, tenant, latency, cost", () => {
    const { getByText } = renderWithProviders(
      <AuditEntryRenderer
        artifact={{
          id: "ae-1",
          timestamp: "2026-06-20T12:00Z",
          actor: { kind: "agent", id: "seniorengineer" },
          tenantId: "acme",
          tool: "jira.create_issue",
          queryHash: "q1234567",
          responseHash: "r7654321",
          latencyMs: 230,
          costUsd: 0.0042,
        }}
      />,
    );
    expect(getByText("2026-06-20T12:00Z")).toBeInTheDocument();
    expect(getByText("agent")).toBeInTheDocument();
    expect(getByText(/jira\.create_issue/)).toBeInTheDocument();
    expect(getByText("acme")).toBeInTheDocument();
    expect(getByText("230ms")).toBeInTheDocument();
    expect(getByText("$0.0042")).toBeInTheDocument();
  });

  it("panel variant renders full metadata dl", () => {
    const { getByText } = renderWithProviders(
      <AuditEntryRenderer
        artifact={{
          id: "ae-2",
          timestamp: "2026-06-20T12:00Z",
          actor: { kind: "user", id: "u-1", displayName: "Jane" },
          tenantId: "acme",
          tool: "github.create_pr",
          queryHash: "abc",
          responseHash: "def",
          latencyMs: 800,
          tokens: { prompt: 100, completion: 200 },
          costUsd: 0.01,
        }}
        variant="panel"
      />,
    );
    expect(getByText("Audit entry")).toBeInTheDocument();
    expect(getByText("github.create_pr")).toBeInTheDocument();
    expect(getByText("100 → 200")).toBeInTheDocument();
  });
});

describe("ApprovalRequestRenderer", () => {
  it("panel variant renders prompt, options, and metadata", () => {
    const { getByText } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={{
          id: "apr-1",
          kind: "ask_user_questions",
          title: "Pick the rollout strategy",
          prompt: "How should we ship Forge v0.2 to prod?",
          state: "pending",
          createdAt: "2026-06-20T11:00Z",
          idempotencyKey: "conf:fora-509:plan:3ea71321",
          options: [
            { id: "bg", label: "Blue-green" },
            { id: "cn", label: "Canary 10%" },
          ],
        }}
        variant="panel"
      />,
    );
    expect(getByText("Pick the rollout strategy")).toBeInTheDocument();
    expect(getByText("How should we ship Forge v0.2 to prod?")).toBeInTheDocument();
    expect(getByText("Blue-green")).toBeInTheDocument();
    expect(getByText("Canary 10%")).toBeInTheDocument();
    expect(getByText("conf:fora-509:plan:3ea71321")).toBeInTheDocument();
  });

  it("inline-banner variant shows declined reason when state is declined", () => {
    const { getByText } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={{
          id: "apr-2",
          kind: "request_confirmation",
          title: "Approve scope",
          prompt: "Ship the renderer layer?",
          state: "declined",
          createdAt: "2026-06-20T10:00Z",
          decider: { displayName: "CTO", id: "cto" },
          decidedAt: "2026-06-20T10:05Z",
          reason: "Wait for v1.1 of charts.",
        }}
      />,
    );
    expect(getByText(/Declined: Wait for v1\.1 of charts\./)).toBeInTheDocument();
  });
});
