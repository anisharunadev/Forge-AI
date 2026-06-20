import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { ApprovalRequestRenderer } from "../src/typed-artifacts/approval-request";
import { PolicyList } from "../src/typed-artifacts/policy-list";
import { RbacRoleViewer } from "../src/typed-artifacts/rbac-role-viewer";
import { BoardConfirmationHistory } from "../src/typed-artifacts/board-confirmation-history";
import { GovernanceCenter } from "../src/typed-artifacts/governance-center";
import {
  evaluateBoardAccess,
  type BoardConfirmation,
  type Policy,
  type RbacRole,
  type RbacToken,
} from "../src/typed-artifacts/governance";
import type { ApprovalRequest } from "../src/typed-artifacts/types";

const BOARD_TOKEN: RbacToken = { kind: "board", displayName: "Board", id: "board" };
const AGENT_TOKEN: RbacToken = { kind: "agent", displayName: "Architect", id: "arch", role: "Architect" };
const USER_TOKEN: RbacToken = { kind: "user", displayName: "Jane CTO", id: "u1" };

const PENDING_CONFIRM: ApprovalRequest = {
  id: "apr-1",
  kind: "request_confirmation",
  title: "Approve FORA-507 v0.4.0 ship",
  prompt: "Ship the Governance Center v1.0 GA.",
  state: "pending",
  createdAt: "2026-06-20T17:00Z",
  idempotencyKey: "conf:fora-507:plan:v0.4.0",
};

const PENDING_QUESTION: ApprovalRequest = {
  id: "apr-2",
  kind: "ask_user_questions",
  title: "Pick the rollout strategy",
  prompt: "How should we ship v0.4.0?",
  state: "pending",
  createdAt: "2026-06-20T16:00Z",
  options: [
    { id: "bg", label: "Blue-green" },
    { id: "cn", label: "Canary 10%" },
  ],
};

const ACCEPTED_CONFIRM: ApprovalRequest = {
  ...PENDING_CONFIRM,
  id: "apr-3",
  state: "accepted",
  decider: { displayName: "Board", id: "board" },
  decidedAt: "2026-06-20T17:05Z",
};

const POLICIES: ReadonlyArray<Policy> = [
  {
    id: "pol-1",
    title: "Deny destructive actions in prod",
    summary: "Block all delete_* MCP tools against prod.",
    dsl: "deny tool:delete_* when env == 'prod'",
    status: "active",
    version: "1.4.0",
    updatedAt: "2026-06-19T10:00Z",
    updatedBy: { displayName: "CTO", id: "cto" },
  },
  {
    id: "pol-2",
    title: "Rate-limit external HTTP egress",
    summary: "Cap egress at 100 req/min/tenant.",
    dsl: "limit egress where target.host matches external",
    status: "archived",
    version: "0.9.0",
    updatedAt: "2025-11-01T10:00Z",
    updatedBy: { displayName: "Architect", id: "arch" },
  },
];

const ROLES: ReadonlyArray<RbacRole> = [
  {
    id: "role-1",
    name: "cto",
    description: "Engineering owner",
    permissions: [
      { resource: "policy", actions: ["read", "write"] },
      { resource: "rbac.role", actions: ["read", "write"] },
      { resource: "approval", actions: ["read", "accept", "decline"] },
    ],
    memberCount: 1,
    system: true,
    updatedAt: "2026-06-15T10:00Z",
  },
  {
    id: "role-2",
    name: "developer",
    description: "Engineers who ship code",
    permissions: [{ resource: "task", actions: ["read", "update"] }],
    memberCount: 14,
    system: false,
    updatedAt: "2026-06-10T10:00Z",
  },
];

const CONFIRMATIONS: ReadonlyArray<BoardConfirmation> = [
  {
    id: "bc-1",
    subject: { identifier: "FORA-393", id: "fora-393" },
    planRev: "v0.1",
    outcome: "accepted",
    decider: { displayName: "Board", id: "board" },
    decidedAt: "2026-06-20T05:30Z",
    idempotencyKey: "conf:fora-393:plan:v0.1",
    prompt: "Approve FORA-393 spine plan rev v0.1.",
  },
  {
    id: "bc-2",
    subject: { identifier: "FORA-128", id: "fora-128" },
    planRev: "v0.7.5",
    outcome: "declined",
    decider: { displayName: "Board", id: "board" },
    decidedAt: "2026-06-17T20:50Z",
    reason: "Wait for AWS SM hand-off.",
    idempotencyKey: "conf:fora-128:plan:v0.7.5",
    prompt: "Approve FORA-128 secrets-mcp v0 ship.",
  },
];

// ---------------------------------------------------------------------------
// evaluateBoardAccess — pure gate. Renderer + server must match byte-for-byte.
// ---------------------------------------------------------------------------

describe("evaluateBoardAccess", () => {
  it("returns Sign-in reason when no token is supplied", () => {
    expect(evaluateBoardAccess(undefined, PENDING_CONFIRM)).toEqual({
      canAccept: false,
      canDecline: false,
      reason: expect.stringMatching(/sign in/i),
    });
  });

  it("returns locked reason when state is non-pending", () => {
    expect(evaluateBoardAccess(BOARD_TOKEN, ACCEPTED_CONFIRM)).toEqual({
      canAccept: false,
      canDecline: false,
      reason: expect.stringMatching(/already accepted/),
    });
  });

  it("Board token can Accept + Decline a request_confirmation", () => {
    expect(evaluateBoardAccess(BOARD_TOKEN, PENDING_CONFIRM)).toEqual({
      canAccept: true,
      canDecline: true,
    });
  });

  it("Agent token is blocked from Accept on request_confirmation (Board access required)", () => {
    const d = evaluateBoardAccess(AGENT_TOKEN, PENDING_CONFIRM);
    expect(d.canAccept).toBe(false);
    expect(d.canDecline).toBe(true);
    expect(d.reason).toMatch(/Board access required/);
  });

  it("User token is blocked from Accept on request_confirmation (Board access required)", () => {
    const d = evaluateBoardAccess(USER_TOKEN, PENDING_CONFIRM);
    expect(d.canAccept).toBe(false);
    expect(d.canDecline).toBe(true);
    expect(d.reason).toMatch(/Board access required/);
  });

  it("ask_user_questions + suggest_tasks are NOT Board-gated", () => {
    expect(evaluateBoardAccess(AGENT_TOKEN, PENDING_QUESTION)).toEqual({
      canAccept: true,
      canDecline: true,
    });
    expect(evaluateBoardAccess(USER_TOKEN, PENDING_QUESTION)).toEqual({
      canAccept: true,
      canDecline: true,
    });
  });
});

// ---------------------------------------------------------------------------
// ApprovalRequestRenderer — Accept/Decline UX + Board-token gating.
// ---------------------------------------------------------------------------

describe("ApprovalRequestRenderer / Accept+Decline", () => {
  it("renders Accept/Decline buttons when state is pending and onAccept/onDecline are wired", () => {
    const { getByTestId } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={PENDING_CONFIRM}
        variant="panel"
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(getByTestId(`approval-accept-${PENDING_CONFIRM.id}`)).toBeInTheDocument();
    expect(getByTestId(`approval-decline-${PENDING_CONFIRM.id}`)).toBeInTheDocument();
  });

  it("does NOT render action buttons when state is not pending", () => {
    const { queryByTestId } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={ACCEPTED_CONFIRM}
        variant="panel"
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(queryByTestId(`approval-accept-${ACCEPTED_CONFIRM.id}`)).toBeNull();
    expect(queryByTestId(`approval-decline-${ACCEPTED_CONFIRM.id}`)).toBeNull();
  });

  it("Accept button is disabled + aria-disabled for an agent token on request_confirmation", () => {
    const { getByTestId } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={PENDING_CONFIRM}
        variant="panel"
        token={AGENT_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    const accept = getByTestId(`approval-accept-${PENDING_CONFIRM.id}`);
    expect(accept).toBeDisabled();
    expect(accept.getAttribute("aria-disabled")).toBe("true");
    // The "Board access required" reason must be exposed through the
    // visually-hidden live region (sr-only) so screen readers hear it.
    expect(accept.parentElement?.textContent ?? "").toMatch(/Board access required/);
  });

  it("Accept button is enabled for a Board token", () => {
    const { getByTestId } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={PENDING_CONFIRM}
        variant="panel"
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    const accept = getByTestId(`approval-accept-${PENDING_CONFIRM.id}`);
    expect(accept).not.toBeDisabled();
    expect(accept.getAttribute("aria-disabled")).toBe("false");
  });

  it("Accept + Decline fire the supplied handlers", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    const { getByTestId } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={PENDING_CONFIRM}
        variant="panel"
        token={BOARD_TOKEN}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );
    getByTestId(`approval-accept-${PENDING_CONFIRM.id}`).click();
    getByTestId(`approval-decline-${PENDING_CONFIRM.id}`).click();
    expect(onAccept).toHaveBeenCalledWith(PENDING_CONFIRM);
    expect(onDecline).toHaveBeenCalledWith(PENDING_CONFIRM);
  });

  it("pending state badge has the pending-tone brand class (Plan 3 §7.2)", () => {
    const { container } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={PENDING_CONFIRM}
        variant="panel"
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    const badge = container.querySelector("[data-state='pending']");
    expect(badge).not.toBeNull();
    expect(badge?.className ?? "").toMatch(/brand-primary/);
  });

  it("accepted state badge has the success-tone brand class (Plan 3 §7.2)", () => {
    const { container } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={{ ...PENDING_CONFIRM, state: "accepted", decider: { displayName: "Board", id: "b" }, decidedAt: "t" }}
        variant="panel"
      />,
    );
    const badge = container.querySelector("[data-state='accepted']");
    expect(badge?.className ?? "").toMatch(/brand-success/);
  });

  it("declined state badge has the danger-tone brand class (Plan 3 §7.2)", () => {
    const { container } = renderWithProviders(
      <ApprovalRequestRenderer
        artifact={{ ...PENDING_CONFIRM, state: "declined", decider: { displayName: "Board", id: "b" }, decidedAt: "t", reason: "x" }}
        variant="panel"
      />,
    );
    const badge = container.querySelector("[data-state='declined']");
    expect(badge?.className ?? "").toMatch(/brand-danger/);
  });
});

// ---------------------------------------------------------------------------
// PolicyList — Plan 3 §7.2 active=brand-primary, archived=neutral
// ---------------------------------------------------------------------------

describe("PolicyList", () => {
  it("renders every policy + the version + the status badge", () => {
    const { getByText, getAllByText } = renderWithProviders(
      <PolicyList policies={POLICIES} />,
    );
    expect(getByText("Deny destructive actions in prod")).toBeInTheDocument();
    expect(getByText("Rate-limit external HTTP egress")).toBeInTheDocument();
    expect(getAllByText("1.4.0").length).toBeGreaterThan(0);
    expect(getAllByText("0.9.0").length).toBeGreaterThan(0);
  });

  it("active policy badge uses brand-primary; archived uses neutral", () => {
    const { container } = renderWithProviders(<PolicyList policies={POLICIES} />);
    const active = container.querySelector("[data-status='active']");
    const archived = container.querySelector("[data-status='archived']");
    expect(active?.className ?? "").toMatch(/brand-primary/);
    expect(archived?.className ?? "").not.toMatch(/brand-primary/);
  });

  it("renders the empty state when policies is empty", () => {
    const { getByText } = renderWithProviders(<PolicyList policies={[]} />);
    expect(getByText(/No rows to display/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RbacRoleViewer — read-only in v1.0
// ---------------------------------------------------------------------------

describe("RbacRoleViewer", () => {
  it("renders every role + member count + permissions count", () => {
    const { getByText } = renderWithProviders(<RbacRoleViewer roles={ROLES} />);
    expect(getByText("cto")).toBeInTheDocument();
    expect(getByText("developer")).toBeInTheDocument();
    expect(getByText("Engineering owner")).toBeInTheDocument();
  });

  it("exposes a 'Read-only view' note (no edit affordance)", () => {
    const { getByText } = renderWithProviders(<RbacRoleViewer roles={ROLES} />);
    expect(getByText(/Read-only view/)).toBeInTheDocument();
  });

  it("marks system roles with a system Badge", () => {
    const { getByLabelText } = renderWithProviders(<RbacRoleViewer roles={ROLES} />);
    expect(getByLabelText("System role")).toBeInTheDocument();
  });

  it("renders the empty state when roles is empty", () => {
    const { getByText } = renderWithProviders(<RbacRoleViewer roles={[]} />);
    expect(getByText(/No rows to display/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BoardConfirmationHistory
// ---------------------------------------------------------------------------

describe("BoardConfirmationHistory", () => {
  it("renders every confirmation + outcome badge + decider", () => {
    const { getByText, container } = renderWithProviders(
      <BoardConfirmationHistory confirmations={CONFIRMATIONS} />,
    );
    expect(getByText("FORA-393")).toBeInTheDocument();
    expect(getByText("FORA-128")).toBeInTheDocument();
    expect(container.querySelector("[data-outcome='accepted']")).not.toBeNull();
    expect(container.querySelector("[data-outcome='declined']")).not.toBeNull();
  });

  it("accepted outcome uses brand-success (Plan 3 §7.2); declined uses brand-danger", () => {
    const { container } = renderWithProviders(
      <BoardConfirmationHistory confirmations={CONFIRMATIONS} />,
    );
    const accepted = container.querySelector("[data-outcome='accepted']");
    const declined = container.querySelector("[data-outcome='declined']");
    expect(accepted?.className ?? "").toMatch(/brand-success/);
    expect(declined?.className ?? "").toMatch(/brand-danger/);
  });
});

// ---------------------------------------------------------------------------
// GovernanceCenter — composition (Plan 1 §3.11)
// ---------------------------------------------------------------------------

describe("GovernanceCenter", () => {
  it("renders the four section headers + headline approval", () => {
    const { getByTestId, getByText } = renderWithProviders(
      <GovernanceCenter
        pendingApprovals={[PENDING_CONFIRM]}
        boardConfirmations={CONFIRMATIONS}
        policies={POLICIES}
        rbacRoles={ROLES}
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={() => undefined}
      />,
    );
    expect(getByTestId("governance-center")).toBeInTheDocument();
    expect(getByTestId("pending-approvals")).toBeInTheDocument();
    expect(getByTestId("board-confirmation-section")).toBeInTheDocument();
    expect(getByTestId("policies-section")).toBeInTheDocument();
    expect(getByTestId("rbac-section")).toBeInTheDocument();
    expect(getByText("Governance Center")).toBeInTheDocument();
  });

  it("shows the empty state for pending approvals when the array is empty", () => {
    const { getByTestId, getByText } = renderWithProviders(
      <GovernanceCenter
        pendingApprovals={[]}
        boardConfirmations={CONFIRMATIONS}
        policies={POLICIES}
        rbacRoles={ROLES}
      />,
    );
    expect(getByTestId("pending-approvals-empty")).toBeInTheDocument();
    expect(getByText(/The Board is caught up/)).toBeInTheDocument();
  });

  it("Accept is gated through evaluateBoardAccess for an agent token", () => {
    const onAccept = vi.fn();
    const { getByTestId } = renderWithProviders(
      <GovernanceCenter
        pendingApprovals={[PENDING_CONFIRM]}
        boardConfirmations={[]}
        policies={[]}
        rbacRoles={[]}
        token={AGENT_TOKEN}
        onAccept={onAccept}
        onDecline={() => undefined}
      />,
    );
    const accept = getByTestId(`approval-accept-${PENDING_CONFIRM.id}`);
    expect(accept).toBeDisabled();
    accept.click();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("Accept fires for a Board token", () => {
    const onAccept = vi.fn();
    const { getByTestId } = renderWithProviders(
      <GovernanceCenter
        pendingApprovals={[PENDING_CONFIRM]}
        boardConfirmations={[]}
        policies={[]}
        rbacRoles={[]}
        token={BOARD_TOKEN}
        onAccept={onAccept}
        onDecline={() => undefined}
      />,
    );
    const accept = getByTestId(`approval-accept-${PENDING_CONFIRM.id}`);
    expect(accept).not.toBeDisabled();
    accept.click();
    expect(onAccept).toHaveBeenCalledWith(PENDING_CONFIRM);
  });

  it("declines the additional pending approvals via the 'N more pending' disclosure", () => {
    const additional = { ...PENDING_CONFIRM, id: "apr-extra", createdAt: "2026-06-20T16:00Z" };
    const onDecline = vi.fn();
    const { getByText, getByTestId } = renderWithProviders(
      <GovernanceCenter
        pendingApprovals={[PENDING_CONFIRM, additional]}
        boardConfirmations={[]}
        policies={[]}
        rbacRoles={[]}
        token={BOARD_TOKEN}
        onAccept={() => undefined}
        onDecline={onDecline}
      />,
    );
    expect(getByText(/1 more pending/)).toBeInTheDocument();
    // Open the <details> + click Decline on the inline-banner render.
    getByTestId(`approval-decline-${additional.id}`).click();
    expect(onDecline).toHaveBeenCalledWith(additional);
  });
});