// Ambient module declarations for Step 5 packages that must be installed
// via `pnpm install` before the build resolves them. These shims keep
// the typecheck clean for local edits; they are not used at runtime.
declare module '@dnd-kit/core' {
  export type DragEndEvent = { active: { id: string | number }; over: { id: string | number } | null };
  export const DndContext: React.FC<{
    children: React.ReactNode;
    sensors?: unknown[];
    collisionDetection?: unknown;
    accessibility?: {
      announcements?: unknown;
      screenReaderInstructions?: unknown;
      restoreFocus?: boolean;
    };
    onDragEnd?: (e: DragEndEvent) => void;
    onDragOver?: (e: { over: { id: string | number } | null }) => void;
    onDragCancel?: () => void;
  }>;
  export const PointerSensor: unknown;
  export const KeyboardSensor: unknown;
  export const closestCorners: unknown;
  export const closestCenter: unknown;
  /** Default announcements — used by IdeaKanban's accessibility config. */
  export const defaultAnnouncements: unknown;
  /** Default screen-reader instructions — used by IdeaKanban. */
  export const defaultScreenReaderInstructions: unknown;
  /** Hook used by droppable containers in the kanban. */
  export function useDroppable(opts: { id: string | number }): {
    setNodeRef: (el: HTMLElement | null) => void;
    isOver: boolean;
    active: unknown;
  };
  export function useSensor(sensor: unknown, opts?: unknown): unknown;
  export function useSensors(...args: unknown[]): unknown[];
}
declare module '@dnd-kit/sortable' {
  export const SortableContext: React.FC<{
    id?: string;
    items: ReadonlyArray<string>;
    strategy?: unknown;
    children: React.ReactNode;
  }>;
  export const verticalListSortingStrategy: unknown;
  export function useSortable(opts: { id: string }): {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    setNodeRef: (el: HTMLElement | null) => void;
    transform: { x: number; y: number; scaleX: number; scaleY: number } | null;
    transition: string | undefined;
    isDragging: boolean;
  };
  export function sortableKeyboardCoordinates(): unknown;
  export function arrayMove<T>(arr: T[], from: number, to: number): T[];
}
declare module '@dnd-kit/utilities' {
  export const CSS: { Transform: { toString(t: unknown): string } };
}
declare module 'sonner' {
  export const Toaster: React.FC<{
    position?: string;
    theme?: string;
    toastOptions?: Record<string, unknown>;
    richColors?: boolean;
    closeButton?: boolean;
  }>;
  export const toast: {
    success: (msg: string, opts?: { description?: string; duration?: number; progressBar?: boolean }) => void;
    error: (msg: string, opts?: { description?: string; duration?: number; progressBar?: boolean }) => void;
    info: (msg: string, opts?: { description?: string; duration?: number; progressBar?: boolean }) => void;
  };
}
declare module '@axe-core/react' {
  const axe: (
    React: unknown,
    ReactDOM: unknown,
    timeout?: number,
  ) => void;
  export default axe;
}
declare module 'framer-motion' {
  type MotionComponent = React.FC<Record<string, unknown>>;
  // Re-declare the structural shape of `motion` so JSX resolution
  // has a usable type. The real framer-motion types live in
  // node_modules/framer-motion/dist/index.d.ts but their intersection
  // type for `motion` collapses to a small subset under TypeScript
  // 5.9, so we re-declare the elements actually used in apps/forge/.
  // See docs/architecture/typescript-patterns.md for context.
  export const motion: {
    span: MotionComponent;
    div: MotionComponent;
    article: MotionComponent;
    li: MotionComponent;
    nav: MotionComponent;
    section: MotionComponent;
    aside: MotionComponent;
    header: MotionComponent;
    footer: MotionComponent;
    main: MotionComponent;
    ul: MotionComponent;
    ol: MotionComponent;
    figure: MotionComponent;
    figcaption: MotionComponent;
    h1: MotionComponent;
    h2: MotionComponent;
    h3: MotionComponent;
    h4: MotionComponent;
    h5: MotionComponent;
    h6: MotionComponent;
    blockquote: MotionComponent;
    pre: MotionComponent;
    table: MotionComponent;
    thead: MotionComponent;
    tbody: MotionComponent;
    tr: MotionComponent;
    td: MotionComponent;
    th: MotionComponent;
    form: MotionComponent;
    label: MotionComponent;
    button: MotionComponent;
    input: MotionComponent;
    textarea: MotionComponent;
    select: MotionComponent;
    option: MotionComponent;
    a: MotionComponent;
    p: MotionComponent;
    path: MotionComponent;
  };
  // AnimatePresence accepts mode and other AnimatePresenceProps.
  // Type as React.FC<Record<string, unknown>> so consumers can
  // pass mode="wait", initial={false}, etc., without the
  // stub rejecting known-good props.
  export const AnimatePresence: React.FC<Record<string, unknown>>;
}
