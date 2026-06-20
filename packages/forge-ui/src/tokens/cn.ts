import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — classnames helper that merges Tailwind utility conflicts deterministically.
 * Standard pattern in Shadcn-based libraries. Used by every primitive.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}