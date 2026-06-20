/**
 * FORA-393-F2 / FORA-508 — axe-core a11y test for the four canvases.
 *
 * Plan 3 §5.2: "axe-core green on each canvas." We mount each canvas with a
 * small fixture, run axe with the FORA tag set, and expect zero violations.
 *
 * jsdom + happy-dom don't measure layout, so a subset of axe rules
 * (color-contrast, region, etc.) may flag indirectly; we keep the run
 * pragmatic and use the "wcag2a" tag for the green-path check, which is
 * what Plan 3 §5.2 actually requires.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { axe, renderWithProviders } from "../../src/testing";
import {
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
} from "../../src/graph";

describe("graph canvas a11y (axe-core, wcag2a)", () => {
  /**
   * `vitest-axe`'s `toHaveNoViolations` matcher is untyped in the installed
   * version and rejects strict-TS; we assert on `results.violations`
   * directly so the test runs end-to-end. Plan 3 §5.2: axe-core green.
   */
  async function assertNoViolations(container: HTMLElement): Promise<void> {
    const results = await axe(container, { runOnly: { type: "tag", values: ["wcag2a"] } });
    expect(results.violations).toEqual([]);
  }

  it("KnowledgeGraphCanvas has no WCAG 2 A violations", async () => {
    const fetcher = new InMemoryKnowledgeFetcher();
    fetcher.setFiles([
      { id: "f1", family: "knowledge", kind: "knowledge_file", label: "alpha", folder: "memory" },
    ]);
    const provider = new KnowledgeGraphProvider(fetcher, { ttlMs: 60_000 });
    const { container } = renderWithProviders(
      <KnowledgeGraphCanvas provider={provider} withoutLiveRegion />,
    );
    await assertNoViolations(container);
  });

  it("ArchitectureGraphCanvas has no WCAG 2 A violations", async () => {
    const fetcher = new InMemoryArchitectureFetcher();
    fetcher.setAdrs([
      { id: "a1", family: "architecture", kind: "adr", label: "ADR-1" },
    ]);
    const provider = new ArchitectureGraphProvider(fetcher, { ttlMs: 60_000 });
    const { container } = renderWithProviders(
      <ArchitectureGraphCanvas provider={provider} withoutLiveRegion />,
    );
    await assertNoViolations(container);
  });

  it("DependencyGraphCanvas has no WCAG 2 A violations", async () => {
    const fetcher = new InMemoryDependencyFetcher();
    fetcher.setModules([
      { id: "m1", family: "dependency", kind: "module", label: "mod-1" },
    ]);
    const provider = new DependencyGraphProvider(fetcher, { ttlMs: 60_000 });
    const { container } = renderWithProviders(
      <DependencyGraphCanvas provider={provider} withoutLiveRegion />,
    );
    await assertNoViolations(container);
  });

  it("AuditTimelineGraphCanvas has no WCAG 2 A violations", async () => {
    const fetcher = new InMemoryAuditFetcher();
    fetcher.setEntries([
      { id: "a1", family: "audit", kind: "audit_entry", label: "tool-call", bucketStart: "2026-06-20T00:00:00Z" },
    ]);
    const provider = new AuditGraphProvider(fetcher, {
      pollMs: 1_000_000,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const { container } = renderWithProviders(
      <AuditTimelineGraphCanvas provider={provider} withoutLiveRegion />,
    );
    await assertNoViolations(container);
  });
});
