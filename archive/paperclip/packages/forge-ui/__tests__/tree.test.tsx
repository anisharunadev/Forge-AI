import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { Tree } from "../src/tree/tree";
import { OrgTree, type Person } from "../src/tree/org-tree";
import { FileTree } from "../src/tree/file-tree";
import { fireEvent, screen } from "@testing-library/react";

describe("Tree", () => {
  const roots = [
    {
      id: "r1",
      label: "Root",
      children: [
        { id: "r1a", label: "Child A" },
        {
          id: "r1b",
          label: "Child B",
          children: [{ id: "r1b1", label: "Grandchild" }],
        },
      ],
    },
  ];

  it("renders a [role=tree] with expanded top-level nodes by default", () => {
    const { getByRole, getAllByRole } = renderWithProviders(
      <Tree roots={roots} ariaLabel="Test tree" />,
    );
    expect(getByRole("tree")).toHaveAttribute("aria-label", "Test tree");
    const items = getAllByRole("treeitem");
    expect(items.length).toBeGreaterThanOrEqual(3); // root + 2 children visible
  });

  it("collapses a node when ArrowLeft is pressed", () => {
    const { getAllByRole } = renderWithProviders(<Tree roots={roots} ariaLabel="Test tree" />);
    const before = getAllByRole("treeitem").length;
    const root = screen.getByRole("treeitem", { name: /Root/ });
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    const after = getAllByRole("treeitem").length;
    expect(after).toBeLessThan(before);
  });

  it("fires onSelect when Enter is pressed", () => {
    let selected: string | null = null;
    renderWithProviders(
      <Tree
        roots={[{ id: "x", label: "Solo" }]}
        ariaLabel="Solo"
        onSelect={(n) => {
          selected = n.id;
        }}
      />,
    );
    const node = screen.getByRole("treeitem", { name: /Solo/ });
    fireEvent.keyDown(node, { key: "Enter" });
    expect(selected).toBe("x");
  });
});

describe("OrgTree", () => {
  it("renders a person record with title annotation", () => {
    const ceo: Person = { id: "p1", displayName: "Jane", title: "CEO" };
    const { getByText } = renderWithProviders(
      <OrgTree
        roots={[{ id: "n1", label: "Jane (CEO)", data: ceo }]}
        ariaLabel="Org"
      />,
    );
    expect(getByText("Jane (CEO)")).toBeInTheDocument();
    expect(getByText("CEO")).toBeInTheDocument();
  });
});

describe("FileTree", () => {
  it("renders folders + files with icons", () => {
    const { container } = renderWithProviders(
      <FileTree
        roots={[
          {
            id: "f1",
            label: "src",
            children: [{ id: "f1a", label: "index.ts", data: { id: "f1a", path: "src/index.ts" } }],
          },
        ]}
      />,
    );
    expect(container.querySelector("ul[role=tree]")).not.toBeNull();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("index.ts")).toBeInTheDocument();
  });
});
