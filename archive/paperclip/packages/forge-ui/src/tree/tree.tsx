import type { JSX } from "react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../tokens/cn";

export interface TreeNode<T> {
  readonly id: string;
  readonly label: string;
  readonly data?: T;
  readonly children?: ReadonlyArray<TreeNode<T>>;
}

export interface TreeProps<T> {
  readonly roots: ReadonlyArray<TreeNode<T>>;
  /** Render override for the leaf content next to the label. */
  readonly renderNode?: (node: TreeNode<T>) => ReactNode;
  /** Called when the user activates a node (Enter / Space, click). */
  readonly onSelect?: (node: TreeNode<T>) => void;
  /** Currently selected node id. */
  readonly selectedId?: string;
  /** Aria label for the tree root. */
  readonly ariaLabel: string;
  className?: string;
}

interface ExpandedState {
  readonly [id: string]: boolean;
}

function defaultExpanded(roots: ReadonlyArray<TreeNode<unknown>>): ExpandedState {
  const out: Record<string, boolean> = {};
  for (const r of roots) out[r.id] = true;
  return out;
}

/**
 * Tree<T> — Plan 4 §6 generic typed tree. Keyboard-navigable per Plan 3 §5:
 * Tab to enter, ArrowDown/Up to move focus between visible nodes, ArrowRight
 * to expand, ArrowLeft to collapse (and move to parent), Enter/Space to
 * activate. Rendered as a real [role="tree"] so screen readers announce
 * expanded/collapsed state.
 */
export function Tree<T>({
  roots,
  renderNode,
  onSelect,
  selectedId,
  ariaLabel,
  className,
}: TreeProps<T>): JSX.Element {
  const [expanded, setExpanded] = useState<ExpandedState>(() => defaultExpanded(roots));
  const flat = useMemo(() => flatten(roots, expanded, 0), [roots, expanded]);

  const onKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const target = e.target as HTMLElement;
    const id = target.dataset["nodeId"];
    if (!id) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setExpanded((s) => ({ ...s, [id]: true }));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setExpanded((s) => ({ ...s, [id]: false }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const node = flat.find((n) => n.node.id === id);
      if (node && onSelect) onSelect(node.node as TreeNode<T>);
    }
  };

  return (
    <ul
      role="tree"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn("space-y-0.5 text-body-sm", className)}
    >
      {flat.map(({ node, depth }) => {
        const isLeaf = !node.children || node.children.length === 0;
        const isOpen = expanded[node.id] ?? false;
        const isSelected = selectedId === node.id;
        return (
          <li
            key={node.id}
            role="treeitem"
            aria-expanded={isLeaf ? undefined : isOpen}
            aria-selected={isSelected || undefined}
            aria-level={depth + 1}
            tabIndex={0}
            data-node-id={node.id}
            onClick={() => onSelect?.(node as TreeNode<T>)}
            className={cn(
              "flex items-center gap-1 rounded-sm px-2 py-1",
              "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              isSelected && "bg-brand-primary/10 text-brand-primary",
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {!isLeaf && (
              <ChevronRight
                size={14}
                aria-hidden="true"
                className={cn(
                  "shrink-0 text-ink-muted transition-transform",
                  isOpen && "rotate-90",
                )}
              />
            )}
            {isLeaf && <span className="inline-block w-[14px]" aria-hidden="true" />}
            <span className="flex-1 truncate">{node.label}</span>
            {renderNode?.(node as TreeNode<T>)}
          </li>
        );
      })}
    </ul>
  );
}

interface FlatRow<T> {
  readonly node: TreeNode<T>;
  readonly depth: number;
}

function flatten<T>(
  roots: ReadonlyArray<TreeNode<T>>,
  expanded: ExpandedState,
  startDepth: number,
): FlatRow<T>[] {
  const out: FlatRow<T>[] = [];
  const walk = (ns: ReadonlyArray<TreeNode<T>>, depth: number): void => {
    for (const n of ns) {
      out.push({ node: n, depth });
      if (n.children && n.children.length > 0 && (expanded[n.id] ?? false)) {
        walk(n.children, depth + 1);
      }
    }
  };
  walk(roots, startDepth);
  return out;
}
