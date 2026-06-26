// Ambient module declarations for Step 5 packages that must be installed
// via `pnpm install` before the build resolves them. These shims keep
// the typecheck clean for local edits; they are not used at runtime.
declare module '@dnd-kit/core' {
  export type DragEndEvent = { active: { id: string | number }; over: { id: string | number } | null };
  export const DndContext: React.FC<{
    children: React.ReactNode;
    sensors?: unknown[];
    collisionDetection?: unknown;
    onDragEnd?: (e: DragEndEvent) => void;
    onDragOver?: (e: { over: { id: string | number } | null }) => void;
    onDragCancel?: () => void;
  }>;
  export const PointerSensor: unknown;
  export const KeyboardSensor: unknown;
  export const closestCorners: unknown;
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
  export const motion: {
    span: React.FC<{
      layoutId?: string;
      className?: string;
      transition?: { type?: string; duration?: number; ease?: number[] };
      children?: React.ReactNode;
      animate?: Record<string, unknown>;
      'aria-hidden'?: boolean | string;
    }>;
    div: React.FC<Record<string, unknown>>;
  };
  export const AnimatePresence: React.FC<{ children: React.ReactNode }>;
}
