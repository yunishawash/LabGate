import { describe, expect, it } from "vitest";
import { strictStr } from "./apiHelpers";

/**
 * `strictStr` is the reject-instead-of-truncate counterpart to `str()` —
 * see the doc comment in apiHelpers.ts for why the two coexist. These are
 * the boundary cases the SRS-follow-up plan calls out explicitly: the exact
 * limit, one over it, a non-string value, whitespace-only input, and Arabic
 * text (to confirm `.length` — UTF-16 code units — is what's being counted,
 * not bytes or grapheme clusters).
 */
describe("strictStr", () => {
  it("accepts a value at exactly the limit", () => {
    const value = "a".repeat(10);
    const r = strictStr(value, 10, "Notes");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(value);
  });

  it("rejects one character over the limit", () => {
    const r = strictStr("a".repeat(11), 10, "Notes");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("TEXT_TOO_LONG");
      expect(r.field).toBe("Notes");
      expect(r.max).toBe(10);
      expect(r.error).toContain("10");
    }
  });

  it("treats undefined as an omitted optional field, not an error", () => {
    const r = strictStr(undefined, 10, "Notes");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("");
  });

  it("treats null the same as undefined", () => {
    const r = strictStr(null, 10, "Notes");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("");
  });

  it("rejects a non-string, non-nullish value", () => {
    const r = strictStr(12345, 10, "Notes");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TEXT_INVALID_TYPE");
  });

  it("rejects an object or array the same way", () => {
    expect(strictStr({ a: 1 }, 10, "Notes").ok).toBe(false);
    expect(strictStr([1, 2, 3], 10, "Notes").ok).toBe(false);
  });

  it("trims before measuring, so whitespace padding cannot itself trip the limit", () => {
    const padded = `  ${"a".repeat(10)}  `;
    const r = strictStr(padded, 10, "Notes");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("a".repeat(10));
  });

  it("collapses whitespace-only input to an empty, accepted value", () => {
    const r = strictStr("   \n\t  ", 10, "Notes");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("");
  });

  it("measures Arabic text by UTF-16 length, matching str()'s own semantics", () => {
    // Arabic letters used here are all in the Basic Multilingual Plane — one
    // UTF-16 code unit each — so this also confirms the count is on
    // characters, not bytes (which would be ~2x for Arabic in UTF-8).
    const arabic10 = "ملاحظاتها،"; // 10 characters
    expect(arabic10.length).toBe(10);
    expect(strictStr(arabic10, 10, "ملاحظات").ok).toBe(true);
    expect(strictStr(arabic10 + "ا", 10, "ملاحظات").ok).toBe(false);
  });

  it("reports the actual trimmed length in the error message", () => {
    const r = strictStr("a".repeat(5000), 4000, "Notes");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("5000");
  });
});
