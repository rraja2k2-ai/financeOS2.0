import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Ensure the current value stays selectable even if it isn't in the master/options list
 *  (e.g. a saved value that predates a taxonomy change). Shared by ReviewScreen's header
 *  dropdowns and TransactionItemRow's category picker. */
export function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}
