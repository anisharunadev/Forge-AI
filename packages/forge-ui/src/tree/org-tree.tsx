import type { JSX } from "react";
import { Tree, type TreeNode } from "./tree";

export interface Person {
  readonly id: string;
  readonly displayName: string;
  readonly title?: string;
  readonly email?: string;
}

export interface OrgTreeProps {
  /** Root(s) — usually the CEO + co-founders. */
  readonly roots: ReadonlyArray<TreeNode<Person>>;
  /** Called when a person is selected. */
  readonly onSelect?: (person: TreeNode<Person>) => void;
  readonly selectedId?: string;
  className?: string;
}

/**
 * OrgTree — Plan 4 §6 typed wrapper for org charts. Uses the Person typed
 * artifact. `treeitem` rows show display name + title.
 */
export function OrgTree({ roots, onSelect, selectedId, className }: OrgTreeProps): JSX.Element {
  return (
    <Tree<Person>
      roots={roots}
      ariaLabel="Organization chart"
      {...(onSelect !== undefined ? { onSelect } : {})}
      {...(selectedId !== undefined ? { selectedId } : {})}
      {...(className !== undefined ? { className } : {})}
      renderNode={(n) =>
        n.data?.title ? (
          <span className="ml-2 text-caption text-ink-muted">{n.data.title}</span>
        ) : null
      }
    />
  );
}
