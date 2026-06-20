import type { JSX } from "react";
import { File, Folder } from "lucide-react";
import { Tree, type TreeNode } from "./tree";

export interface FileTreeEntry {
  readonly id: string;
  /** Path relative to the root (e.g. "src/typed-artifacts/types.ts"). */
  readonly path: string;
}

export interface FileTreeProps {
  readonly roots: ReadonlyArray<TreeNode<FileTreeEntry>>;
  readonly onSelect?: (entry: TreeNode<FileTreeEntry>) => void;
  readonly selectedId?: string;
  className?: string;
}

/**
 * FileTree — Plan 4 §6 typed wrapper for Knowledge Layer file trees. Each row
 * gets a file/folder glyph (decorative — the label is the accessible name).
 */
export function FileTree({ roots, onSelect, selectedId, className }: FileTreeProps): JSX.Element {
  return (
    <Tree<FileTreeEntry>
      roots={roots}
      ariaLabel="File tree"
      {...(onSelect !== undefined ? { onSelect } : {})}
      {...(selectedId !== undefined ? { selectedId } : {})}
      {...(className !== undefined ? { className } : {})}
      renderNode={(n) => {
        const isDir = !!n.children && n.children.length > 0;
        const Icon = isDir ? Folder : File;
        return <Icon size={14} aria-hidden="true" className="ml-1 shrink-0 text-ink-muted" />;
      }}
    />
  );
}
