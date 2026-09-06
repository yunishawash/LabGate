import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Local (not UTC) YYYY-MM-DD for <input type="date">. Using toISOString()
 * shifts the date by a day near midnight in timezones ahead of UTC — a bug
 * the CMMS hit and fixed this way.
 */
export function toDateInputValue(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * How long something has been waiting: "3d 4h" · "5h 12m" · "18m" · "just now".
 * Takes MILLISECONDS. (The CMMS's formatIdleTime takes minutes and stops at
 * hours — this one needs a day unit for the approval-ladder aging clock.)
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rem}m`;
  return `${mins}m`;
}
