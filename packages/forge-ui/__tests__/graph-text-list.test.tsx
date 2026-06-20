/**
 * FORA-393-F2 / FORA-508 — text-equivalent list view + canvas-shell rendering tests.
 *
 * Verifies:
 *  - TextListView renders one row per node + outgoing edges
 *  - visuallyHidden toggles the screen-reader-only class
 *  - The four canvas components mount + expose role="application"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import {
  TextListView,
  KnowledgeGraphCanvas,
  ArchitectureGraphCanvas,
  DependencyGraphCanvas,
  AuditTimelineGraphCanvas,
  KnowledgeGraphProvider,
  InMemoryKnowledgeFetcher,
  ArchitectureGraphProvider,
  InMemoryArchitectureFetcher,
  DependencyGraphProvider,
  InMemoryDependencyFetcher,
  AuditGraphProvider,
  InMemoryAuditFetcher,
} from "../src/graph";
import type {
  KnowledgeNode,
  KnowledgeEdge,
  ArchitectureNode,
  DependencyNode,
  DependencyEdge,
  AuditNode,
  AuditEdge,
} from "../src/graph";

const seed = (
  nodes: KnowledgeNode[] = [
    { id: "f1", family: "knowledge", kind: "knowledge_file", label: "memory/x.md", folder: "memory" },
  ],
  edges: KnowledgeEdge[] = [],
): { provider: KnowledgeGraphProvider; fetcher: InMemoryKnowledgeFetcher } => {
  const fetcher = new InMemoryKnowledgeFetcher({ files: nodes, edges });
  const provider = new KnowledgeGraphProvider(fetcher, { ttlMs: 60_000 });
  return { provider, fetcher };
};

describe("TextListView", () => {
  it("renders one row per node", () => {
    const { getAllByRole } = renderWithProviders(
      <TextListView
        nodes={[
          { id: "a", family: "knowledge", kind: "knowledge_file", label: "alpha" },
          { id: "b", family: "knowledge", kind: "glossary_entry", label: "beta" },
        ]}
        edges={[]}
        ariaLabel="Test list"
      />,
    );
    expect(getAllByRole("listitem").length).toBe(2);
  });

  it("renders outgoing edges under each source node", () => {
    const { getByText } = renderWithProviders(
      <TextListView
        nodes={[
          { id: "a", family: "knowledge", kind: "knowledge_file", label: "alpha" },
          { id: "b", family: "knowledge", kind: "knowledge_file", label: "beta" },
        ]}
        edges={[{ id: "e1", source: "a", target: "b", kind: "references" }]}
        ariaLabel="Test list"
      />,
    );
    expect(getByText(/references/)).toBeInTheDocument();
  });

  it("visuallyHidden applies the screen-reader-only class", () => {
    const { container } = renderWithProviders(
      <TextListView
        nodes={[]}
        edges={[]}
        ariaLabel="Test list"
        visuallyHidden
      />,
    );
    expect(container.querySelector(".sr-only")).toBeTruthy();
  });
});

describe("Canvas shell wrappers", () => {
  it("KnowledgeGraphCanvas mounts with role=application + skip link", () => {
    const { provider } = seed();
    const { container, getByRole } = renderWithProviders(
      <KnowledgeGraphCanvas provider={provider} withoutLiveRegion />,
    );
    expect(getByRole("application", { name: /Knowledge Graph/i })).toBeInTheDocument();
    expect(container.querySelector('a[href="#knowledge-text-list"]')).toBeTruthy();
  });

  it("ArchitectureGraphCanvas mounts", () => {
    const fetcher = new InMemoryArchitectureFetcher();
    fetcher.setAdrs([
      { id: "a1", family: "architecture", kind: "adr", label: "ADR-1" },
    ]);
    const provider = new ArchitectureGraphProvider(fetcher, { ttlMs: 60_000 });
    const { getByRole } = renderWithProviders(
      <ArchitectureGraphCanvas provider={provider} withoutLiveRegion />,
    );
    expect(getByRole("application", { name: /Architecture Graph/i })).toBeInTheDocument();
  });

  it("DependencyGraphCanvas mounts", () => {
    const fetcher = new InMemoryDependencyFetcher();
    const m: DependencyNode[] = [
      { id: "m1", family: "dependency", kind: "module", label: "mod-1" },
    ];
    fetcher.setModules(m);
    const provider = new DependencyGraphProvider(fetcher, { ttlMs: 60_000 });
    const { getByRole } = renderWithProviders(
      <DependencyGraphCanvas provider={provider} withoutLiveRegion />,
    );
    expect(getByRole("application", { name: /Dependency Graph/i })).toBeInTheDocument();
  });

  it("AuditTimelineGraphCanvas mounts", () => {
    const fetcher = new InMemoryAuditFetcher();
    const e: AuditNode[] = [
      { id: "a1", family: "audit", kind: "audit_entry", label: "tool-call", bucketStart: "2026-06-20T00:00:00Z" },
    ];
    const ae: AuditEdge[] = [];
    fetcher.setEntries(e);
    fetcher.setEdges(ae);
    const provider = new AuditGraphProvider(fetcher, {
      pollMs: 1_000_000,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const { getByRole } = renderWithProviders(
      <AuditTimelineGraphCanvas provider={provider} withoutLiveRegion />,
    );
    expect(getByRole("application", { name: "Audit Timeline Graph" })).toBeInTheDocument();
  });
});
