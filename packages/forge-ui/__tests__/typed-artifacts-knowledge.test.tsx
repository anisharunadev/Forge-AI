/**
 * FORA-502 — typed-artifact renderers for the Knowledge Center.
 *
 * Plan 1 §3.3 typed-artifact surface: `KnowledgeFile`, `GlossaryEntry`,
 * `StageInjectionMap`. Plan 4 §3.1 + §3.10 — renderer mirror of the
 * Handoff Contract shape. Every assertion here is a test of the
 * renderer contract; the producer side (the manifest emitted by the
 * Knowledge Layer producer, FORA-389) is out of scope.
 */
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "../src/testing/render-with-providers";
import { KnowledgeFileRenderer } from "../src/typed-artifacts/knowledge-file";
import { GlossaryEntryRenderer } from "../src/typed-artifacts/glossary-entry";
import { StageInjectionMapRenderer } from "../src/typed-artifacts/stage-injection-map";
import type { KnowledgeFile } from "../src/typed-artifacts/types";

const CODING_MD: KnowledgeFile = {
  id: "kf-coding-md",
  path: "memory/coding.md",
  title: "coding.md",
  folder: "memory",
  fileType: "markdown",
  byteSize: 11200,
  versionHash: "9a3b1f2c8d04",
  injectionRoles: [
    { stage: "Developer", role: "primary" },
    { stage: "QA", role: "secondary" },
  ],
  updatedAt: "2026-06-19T22:00:00Z",
};

const GLOSSARY_MD: KnowledgeFile = {
  id: "kf-glossary-md",
  path: "customer/glossary.md",
  title: "glossary.md",
  folder: "customer",
  fileType: "glossary",
  byteSize: 13400,
  versionHash: "1f4b2e9a7733",
  injectionRoles: [
    { stage: "BA", role: "glossary" },
    { stage: "Developer", role: "glossary" },
  ],
};

describe("KnowledgeFileRenderer", () => {
  it("card variant surfaces path + folder + file-type badges", () => {
    const { getByText, getByLabelText, getByTestId } = renderWithProviders(
      <KnowledgeFileRenderer artifact={CODING_MD} variant="card" />,
    );
    expect(getByText("coding.md")).toBeInTheDocument();
    expect(getByText("memory/coding.md")).toBeInTheDocument();
    expect(getByLabelText("Folder: memory")).toBeInTheDocument();
    expect(getByLabelText("File type: markdown")).toBeInTheDocument();
    expect(getByTestId("knowledge-file-card").getAttribute("data-folder")).toBe("memory");
  });

  it("card variant formats byte size + version hash + stage count", () => {
    const { getByText } = renderWithProviders(
      <KnowledgeFileRenderer artifact={CODING_MD} variant="card" />,
    );
    expect(getByText(/10\.9 KB/)).toBeInTheDocument();
    expect(getByText(/sha 9a3b1f2c8d04/)).toBeInTheDocument();
    expect(getByText(/2 stages/)).toBeInTheDocument();
  });

  it("panel variant includes metadata table and body when content is provided", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithProviders(
      <KnowledgeFileRenderer
        artifact={{ ...CODING_MD, content: "# Coding\n\nThe PR bar." }}
        variant="panel"
      />,
    );
    const panel = getByTestId("knowledge-file-panel");
    expect(panel.getAttribute("data-folder")).toBe("memory");
    expect(panel.getAttribute("data-file-type")).toBe("markdown");
    const pre = getByText(
      (content, element) =>
        element?.tagName === "PRE" && content.includes("# Coding") && content.includes("The PR bar."),
    );
    expect(pre).toBeInTheDocument();
    // Sanity: 2 stages appear in the panel.
    expect(getByText(/Developer, QA/)).toBeInTheDocument();
    // No injection-list markers in panel.
    expect(queryByTestId("knowledge-file-injection-row")).not.toBeInTheDocument();
  });

  it("injection-list variant renders a list row with per-stage roles", () => {
    const { getAllByTestId, getByText } = renderWithProviders(
      <ul>
        <KnowledgeFileRenderer artifact={CODING_MD} variant="injection-list" />
        <KnowledgeFileRenderer artifact={GLOSSARY_MD} variant="injection-list" />
      </ul>,
    );
    const rows = getAllByTestId("knowledge-file-injection-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-folder")).toBe("memory");
    expect(rows[1]!.getAttribute("data-folder")).toBe("customer");
    expect(getByText(/memory\/coding\.md/)).toBeInTheDocument();
    expect(getByText(/Developer: primary/)).toBeInTheDocument();
    expect(getByText(/customer\/glossary\.md/)).toBeInTheDocument();
  });

  it("handles zero injection roles without throwing", () => {
    const { getByText } = renderWithProviders(
      <ul>
        <KnowledgeFileRenderer
          artifact={{ ...CODING_MD, injectionRoles: [] }}
          variant="injection-list"
        />
      </ul>,
    );
    expect(getByText("no stage injection")).toBeInTheDocument();
  });
});

describe("GlossaryEntryRenderer", () => {
  it("card variant shows term + usage count", () => {
    const { getByText, getByLabelText, getByTestId } = renderWithProviders(
      <GlossaryEntryRenderer
        artifact={{
          id: "gl-1",
          term: "Handoff Contract",
          definition: "The JSON envelope every stage hands to the next.",
          usageCount: 7,
        }}
        variant="card"
      />,
    );
    expect(getByText("Handoff Contract")).toBeInTheDocument();
    expect(getByText("7")).toBeInTheDocument();
    expect(getByLabelText("Used by 7 files")).toBeInTheDocument();
    expect(getByTestId("glossary-entry-card").getAttribute("data-usage")).toBe("7");
  });

  it("panel variant surfaces anti-glossary callout when present", () => {
    const { getByText, getByLabelText } = renderWithProviders(
      <GlossaryEntryRenderer
        artifact={{
          id: "gl-2",
          term: "Agent",
          definition: "A sub-agent in the Forge AI runtime.",
          usageCount: 4,
          antiNote: "Not the same as a 'subprocess' or a 'microservice'.",
        }}
        variant="panel"
      />,
    );
    expect(getByText("Not the same as a 'subprocess' or a 'microservice'.")).toBeInTheDocument();
    expect(getByLabelText("Anti-glossary note")).toBeInTheDocument();
  });

  it("card variant line-clamps long definitions", () => {
    const longDef = "word ".repeat(120);
    const { container } = renderWithProviders(
      <GlossaryEntryRenderer
        artifact={{ id: "gl-3", term: "LongDef", definition: longDef, usageCount: 1 }}
        variant="card"
      />,
    );
    const clamped = container.querySelector(".line-clamp-2");
    expect(clamped).not.toBeNull();
    expect(clamped!.textContent).toContain("word");
  });
});

describe("StageInjectionMapRenderer", () => {
  it("panel variant composes per-stage file rows from `files`", () => {
    const { getByTestId, getByText } = renderWithProviders(
      <StageInjectionMapRenderer
        artifact={{
          id: "sim-developer",
          stage: "Developer",
          fileIds: ["kf-coding-md", "kf-architecture-md"],
          glossaryFileIds: ["kf-glossary-md"],
          ownerRole: "SeniorEngineer",
        }}
        files={[
          CODING_MD,
          {
            id: "kf-architecture-md",
            path: "memory/architecture.md",
            title: "architecture.md",
            folder: "memory",
            fileType: "markdown",
            byteSize: 10240,
            versionHash: "ff00aa11bb22",
            injectionRoles: [{ stage: "Developer", role: "primary" }],
          },
          GLOSSARY_MD,
        ]}
      />,
    );
    const panel = getByTestId("stage-injection-panel");
    expect(panel.getAttribute("data-stage")).toBe("Developer");
    expect(getByText("Co-owner: SeniorEngineer")).toBeInTheDocument();
    expect(getByText("memory/coding.md")).toBeInTheDocument();
    expect(getByText("memory/architecture.md")).toBeInTheDocument();
    expect(getByText("customer/glossary.md")).toBeInTheDocument();
  });

  it("row variant surfaces stage label + file count", () => {
    const { getByTestId, getByLabelText } = renderWithProviders(
      <ul>
        <StageInjectionMapRenderer
          artifact={{
            id: "sim-qa",
            stage: "QA",
            fileIds: ["kf-coding-md"],
            glossaryFileIds: ["kf-glossary-md"],
            ownerRole: "QA",
          }}
          files={[CODING_MD, GLOSSARY_MD]}
          variant="row"
        />
      </ul>,
    );
    const row = getByTestId("stage-injection-row");
    expect(row.getAttribute("data-stage")).toBe("QA");
    // Scope to the summary <p> (the second <p> inside the row). The row
    // also contains the stage label and the badge; concatenated text would
    // be misleading.
    const summary = row.querySelectorAll("p")[1]!;
    expect(summary.textContent).toMatch(/1 file/);
    expect(summary.textContent).toMatch(/\+glossary/);
    expect(summary.textContent).toMatch(/owner: QA/);
    // Badge aria-label: "1 file injected" (the badge value is the sum,
    // 2, but the aria-label names the *file* count for the screen reader).
    expect(getByLabelText("1 file injected")).toBeInTheDocument();
  });

  it("panel variant surfaces an empty-state when no files are injected", () => {
    const { getByText } = renderWithProviders(
      <StageInjectionMapRenderer
        artifact={{
          id: "sim-empty",
          stage: "Memory",
          fileIds: [],
          glossaryFileIds: [],
        }}
        files={[]}
      />,
    );
    expect(getByText(/No files are injected for this stage\./)).toBeInTheDocument();
  });

  it("panel variant silently drops missing file ids (defensive)", () => {
    const { getByText, queryByText } = renderWithProviders(
      <StageInjectionMapRenderer
        artifact={{
          id: "sim-partial",
          stage: "Cost",
          fileIds: ["kf-coding-md", "kf-missing"],
          glossaryFileIds: [],
        }}
        files={[CODING_MD]}
      />,
    );
    expect(getByText("memory/coding.md")).toBeInTheDocument();
    // No thrown row for the missing id; renderer must not crash.
    expect(queryByText("kf-missing")).not.toBeInTheDocument();
  });
});
