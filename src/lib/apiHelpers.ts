import { NextResponse } from "next/server";
import mongoose from "mongoose";

/**
 * Small, boring helpers shared by every route handler. They exist so the three
 * mistakes the CMMS's lab API made cannot be repeated by accident:
 *
 *   1. raw request bodies fed to `create()` / `$set` — mass assignment
 *   2. path ids cast to ObjectId with no validity check — 500 on junk input
 *   3. user input interpolated into a regex — a `(` in a search box throws
 */

export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });
export const notFound = (error = "Not found") => NextResponse.json({ error }, { status: 404 });
export const conflict = (error: string) => NextResponse.json({ error }, { status: 409 });

/** Parse a JSON body, or return null. Never throws on an empty/!JSON body. */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A valid ObjectId, or null. Always check before casting a path parameter. */
export function oid(value: unknown): mongoose.Types.ObjectId | null {
  const s = typeof value === "string" ? value : String(value ?? "");
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/**
 * Copy only the named fields out of a body. THE defence against mass
 * assignment: without it, a client can set `role`, `isActive`, `_id` or
 * anything else the schema happens to have.
 */
export function pick<T extends string>(
  body: Record<string, unknown>,
  fields: readonly T[]
): Partial<Record<T, unknown>> {
  const out: Partial<Record<T, unknown>> = {};
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
  }
  return out;
}

/** Escape user input before it goes into a RegExp. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A case-insensitive "contains" filter built safely from user input. */
export function containsRegex(input: string) {
  return { $regex: escapeRegex(input.trim()), $options: "i" };
}

/** A finite number, or null. Rejects "", NaN, Infinity and non-numerics. */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A trimmed string, capped so a runaway paste cannot bloat a document. */
export function str(value: unknown, max = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export interface StrictStrOk {
  ok: true;
  value: string;
}

export interface StrictStrError {
  ok: false;
  /** English message, ready to hand to `badRequest()` directly. */
  error: string;
  /** Stable, language-independent reason — for a future client-side bilingual
   *  message map, so this doesn't need re-touching when that map exists. */
  code: "TEXT_TOO_LONG" | "TEXT_INVALID_TYPE";
  field: string;
  max?: number;
}

export type StrictStrResult = StrictStrOk | StrictStrError;

/**
 * Like `str()`, but REJECTS instead of silently truncating.
 *
 * `str()` is right for the ~80 short, incidental fields (codes, phone
 * numbers, enum-ish values) where a client that somehow sends too much just
 * loses the tail with no real consequence. It is wrong for the long free-text
 * fields a person actually composes — order notes, a rejection reason, a
 * sample's notes — where losing the tail silently is losing part of what they
 * wrote, with no error and no way to know. Those fields call this instead.
 *
 * An omitted or `null`/`undefined` value is NOT an error — every field this
 * guards is optional; only a value that is present but too long, or present
 * and not a string at all, is rejected. `fieldLabel` is the human-readable
 * name for the message ("Notes", "Rejection reason", …).
 */
export function strictStr(value: unknown, max: number, fieldLabel: string): StrictStrResult {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldLabel} must be text.`, code: "TEXT_INVALID_TYPE", field: fieldLabel };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return {
      ok: false,
      error: `${fieldLabel} is too long (max ${max} characters, got ${trimmed.length}).`,
      code: "TEXT_TOO_LONG",
      field: fieldLabel,
      max,
    };
  }
  return { ok: true, value: trimmed };
}

/** A 400 for a `strictStr` failure — carries a stable `code` (and `max`,
 *  where relevant) so a future client can localize the message without
 *  string-matching English text. Never call with an `{ ok: true }` result. */
export function badStrictStr(r: StrictStrError) {
  return NextResponse.json({ error: r.error, code: r.code, field: r.field, max: r.max }, { status: 400 });
}

/** One of `allowed`, or `fallback`. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * End-of-day inclusive date range from `from`/`to` query params — the house
 * convention, so "to = today" includes everything recorded today.
 */
export function dateRange(from: string | null, to: string | null) {
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length ? range : null;
}

/** Clamped paging, so `?limit=999999` cannot be used to pull the whole table. */
export function paging(searchParams: URLSearchParams, defaultLimit = 25, maxLimit = 200) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit")) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Collapse a name to a comparison key: lowercased, trimmed, internal runs of
 * whitespace reduced to one space.
 *
 * Anchored-regex matching is not enough on its own — it catches
 * "  مخبز البركة  " but happily lets "TEST   bakery" through beside
 * "Test Bakery". Storing the key and indexing it makes the rule exact and
 * lets the database enforce it, instead of a check that two concurrent
 * requests can both pass.
 */
export function normalizeName(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Did this write fail because a unique index rejected it? */
export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

/** The field a duplicate-key error was raised on, for a readable message. */
export function duplicateKeyField(err: unknown): string {
  const pattern = (err as { keyPattern?: Record<string, unknown> } | null)?.keyPattern;
  return pattern ? Object.keys(pattern)[0] ?? "value" : "value";
}
