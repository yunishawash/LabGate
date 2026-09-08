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
 * A formatted date is a single left-to-right unit. Dropped straight into an
 * Arabic (RTL) paragraph the browser reorders its parts — "04 Sept 2026"
 * renders as "Sept 2026 04". Wrap dates, times, durations and any Latin-numeral
 * run in this so the bidi algorithm treats it as one isolated token.
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * How long something has been waiting: "3d 4h" · "5h 12m" · "18m" · "just now".
 * Takes MILLISECONDS. (The CMMS's formatIdleTime takes minutes and stops at
 * hours — this one needs a day unit for the approval-ladder aging clock.)
 */
/**
 * "3d 4h" / "٣ ي ٤ س" — how long an order has sat somewhere.
 *
 * The unit letters are part of the sentence, so they take the language like any
 * other word. Digits stay Latin: the whole app shows Latin numerals (tonnages,
 * bag counts, order numbers), and Arabic-Indic here alone would read as a typo.
 */
export function formatDuration(ms: number, lang: "en" | "ar" = "en"): string {
  const ar = lang === "ar";
  if (!Number.isFinite(ms) || ms < 60_000) return ar ? "الآن" : "just now";
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  const [d, h, m] = ar ? ["ي", "س", "د"] : ["d", "h", "m"];
  if (days > 0) return `${days}${d} ${hours}${h}`;
  if (hours > 0) return `${hours}${h} ${rem}${m}`;
  return `${mins}${m}`;
}
