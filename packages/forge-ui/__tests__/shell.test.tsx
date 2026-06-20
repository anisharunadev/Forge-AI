import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { Shell } from "../src/shell/shell";
import { TenantBadge } from "../src/shell/tenant-badge";
import { BudgetMeter } from "../src/shell/budget-meter";
import { GlobalSearch } from "../src/shell/global-search";
import { NotificationBell } from "../src/shell/notification-bell";
import { fireEvent, screen } from "@testing-library/react";

describe("Shell", () => {
  it("renders top-bar + left rail + main + active aria-current", () => {
    const { getByRole } = renderWithProviders(
      <Shell
        centers={[
          { id: "dashboard", label: "Dashboard", href: "/dash" },
          { id: "audit", label: "Audit", href: "/audit" },
        ]}
        activeCenterId="dashboard"
      >
        <p>main content</p>
      </Shell>,
    );
    expect(getByRole("banner")).toBeInTheDocument();
    expect(getByRole("navigation", { name: "Centers" })).toBeInTheDocument();
    expect(getByRole("main")).toHaveTextContent("main content");
    const active = getByRole("link", { name: "Dashboard" });
    expect(active).toHaveAttribute("aria-current", "page");
    const inactive = getByRole("link", { name: "Audit" });
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("composes tenant badge, global search, notifications, budget meter when wired", () => {
    renderWithProviders(
      <Shell
        centers={[{ id: "x", label: "X", href: "/x" }]}
        tenant={{ id: "acme", displayName: "Acme Corp" }}
        search={{ value: "", onChange: () => undefined }}
        notifications={{ unreadCount: 3, onOpen: () => undefined }}
        budget={{ spentUsd: 12.34, capUsd: 100, label: "Tenant" }}
      >
        body
      </Shell>,
    );
    expect(screen.getByLabelText("Active tenant: Acme Corp")).toBeInTheDocument();
    expect(screen.getByLabelText("Global search")).toBeInTheDocument();
    expect(screen.getByLabelText(/Notifications.*3 unread/)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: /Tenant/ })).toBeInTheDocument();
  });
});

describe("Top-bar widgets", () => {
  it("TenantBadge announces tenant identity", () => {
    const { getByLabelText } = renderWithProviders(<TenantBadge tenantId="acme" tenantName="Acme Corp" />);
    expect(getByLabelText("Active tenant: Acme Corp")).toBeInTheDocument();
  });

  it("BudgetMeter tones success/warn/danger based on percentage", () => {
    const ok = renderWithProviders(<BudgetMeter spentUsd={10} capUsd={100} />);
    expect(ok.getByRole("meter")).toHaveAttribute("aria-valuenow", "10");

    ok.unmount();
    const warn = renderWithProviders(<BudgetMeter spentUsd={85} capUsd={100} />);
    expect(warn.getByRole("meter")).toHaveAttribute("aria-valuenow", "85");

    warn.unmount();
    const danger = renderWithProviders(<BudgetMeter spentUsd={97} capUsd={100} />);
    expect(danger.getByRole("meter")).toHaveAttribute("aria-valuenow", "97");
  });

  it("GlobalSearch submits via Enter", () => {
    let submitted = "";
    renderWithProviders(
      <GlobalSearch
        value="forge ui"
        onChange={() => undefined}
        onSubmit={(v) => {
          submitted = v;
        }}
      />,
    );
    const input = screen.getByLabelText("Global search") as HTMLInputElement;
    fireEvent.submit(input.form!);
    expect(submitted).toBe("forge ui");
  });

  it("NotificationBell hides badge at 0", () => {
    const { queryByText } = renderWithProviders(<NotificationBell unreadCount={0} />);
    expect(queryByText("0")).toBeNull();
  });
});
