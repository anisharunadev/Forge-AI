/**
 * KnowledgeFileTree — forge-console folder tree for the Knowledge
 * Center left rail.
 *
 * A self-contained folder + file tree, rendered as a static nested
 * list. The forge app does not depend on `the v2.0 design system` (per the
 * connector-center precedent), so this is a local implementation of
 * the same shape the shipped `FileTree` (Plan 4 §6) produces.
 *
 * Why a local impl:
 *   * The forge app uses `forge-*` tailwind tokens, not the brand
 *     tokens that ship with `the v2.0 tree primitives`.
 *   * The `FileTree` from forge-ui reads the `TreeNode<FileTreeEntry>`
 *     shape; this component builds that shape from the
 *     `KnowledgeFile[]` manifest and renders it directly.
 *
 * The renderer mirror is in `apps/forge/lib/knowledge/types.ts`.
 * The renderer contract in the v2.0 typed-artifact system is the
 * source of truth; this component is the consumer-facing view.
 */
import Link from "next/link";
import type { KnowledgeFile, KnowledgeFolder } from "@/lib/knowledge/types";
import { KNOWLEDGE_FOLDERS } from "@/lib/knowledge/manifest";

const FOLDER_LABEL: Record<KnowledgeFolder, string> = {
  memory: "memory/",
  customer: "customer/",
  project: "project/",
  engagements: "engagements/<slug>/",
  reference: "reference/",
};

const FOLDER_ICON: Record<KnowledgeFolder, string> = {
  memory: "📘",
  customer: "📙",
  project: "📗",
  engagements: "📕",
  reference: "📓",
};

export interface KnowledgeFileTreeProps {
  readonly files: ReadonlyArray<KnowledgeFile>;
  readonly selectedPath?: string;
  /** Optional folder + file-type filter state — used to dim non-matching rows. */
  readonly activeFolder?: KnowledgeFolder | "all";
  readonly activeFileType?: string | "all";
}

export function KnowledgeFileTree({
  files,
  selectedPath,
  activeFolder = "all",
  activeFileType = "all",
}: KnowledgeFileTreeProps) {
  const byFolder = new Map<KnowledgeFolder, KnowledgeFile[]>();
  for (const f of files) {
    if (!byFolder.has(f.folder)) byFolder.set(f.folder, []);
    byFolder.get(f.folder)!.push(f);
  }
  for (const list of byFolder.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path));
  }

  return (
    <nav aria-label="Knowledge Layer folders" data-testid="knowledge-file-tree">
      <ul className="space-y-3 text-sm">
        {KNOWLEDGE_FOLDERS.map((folder) => {
          const items = byFolder.get(folder) ?? [];
          const dimFolder = activeFolder !== "all" && activeFolder !== folder;
          return (
            <li key={folder} data-testid="knowledge-tree-folder" data-folder={folder}>
              <p
                className={`flex items-center gap-2 font-mono text-xs uppercase tracking-wider ${
                  dimFolder ? "text-forge-500" : "text-forge-300"
                }`}
                data-testid="knowledge-tree-folder-label"
              >
                <span aria-hidden="true">{FOLDER_ICON[folder]}</span>
                {FOLDER_LABEL[folder]}
                <span className="ml-1 text-forge-500">({items.length})</span>
              </p>
              {items.length > 0 ? (
                <ul className="mt-1 space-y-0.5 pl-5">
                  {items.map((file) => {
                    const dimmed =
                      (activeFileType !== "all" && activeFileType !== file.fileType) ||
                      dimFolder;
                    const selected = file.path === selectedPath;
                    return (
                      <li key={file.id}>
                        <Link
                          href={`/knowledge-center?file=${encodeURIComponent(file.path)}`}
                          data-testid="knowledge-tree-file-link"
                          data-file-path={file.path}
                          data-file-type={file.fileType}
                          aria-current={selected ? "page" : undefined}
                          className={`block truncate rounded-sm px-2 py-1 font-mono text-xs ${
                            selected
                              ? "bg-forge-700/40 text-forge-50"
                              : dimmed
                                ? "text-forge-500 hover:bg-forge-800/40"
                                : "text-forge-200 hover:bg-forge-800/40"
                          }`}
                        >
                          {file.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 pl-5 text-xs italic text-forge-500">empty</p>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
