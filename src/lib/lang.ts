/**
 * Language is a COOKIE, not localStorage.
 *
 * The server has to know the language before it renders a single byte: the
 * `<html>` tag carries `lang` and `dir`, and getting them wrong means an Arabic
 * user watches an English LTR page repaint itself into Arabic RTL — a flash of
 * the wrong direction, a full re-layout and a font swap, on every cold load.
 *
 * localStorage cannot be read on the server, which is why the previous
 * implementation had to start at "en" and correct itself in an effect. A cookie
 * rides along with the document request, so `src/app/layout.tsx` emits the right
 * values in the first byte and the hydration mismatch becomes structurally
 * impossible rather than merely avoided.
 *
 * Pure module — no `next/headers`, no React. Client and server both import it.
 */

export type Lang = "en" | "ar";

/** NOT "cmms-lang" — same origin, different app. */
export const LANG_COOKIE = "labgate-lang";

/**
 * Arabic is the plant's working language; English is the option, not the
 * default. Somebody who has never chosen gets Arabic.
 */
export const DEFAULT_LANG: Lang = "ar";

/** One year — long enough that a shared floor terminal keeps its language. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ar";
}

export function dirFor(lang: Lang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** Narrow a raw cookie value to a Lang, falling back to the default. */
export function langFromCookie(value: string | undefined | null): Lang {
  return isLang(value) ? value : DEFAULT_LANG;
}

/**
 * The cookie string the client writes when the language is toggled.
 *
 * `SameSite=Lax` because this is a preference, not a credential. No `Secure`
 * flag at all — unlike the session cookie (`auth.config.ts`, whose `secure` is
 * env-driven per SPEC §19.4), this one has no confidentiality to protect, so it
 * is written unconditionally and works whether the deployment ends up on plain
 * HTTP or TLS.
 */
export function langCookieString(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
}
