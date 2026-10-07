import fs from "fs";
import path from "path";

/**
 * Helpers both printed documents need — the MS-SC/F7 order form and the
 * weighbridge certificate.
 *
 * They lived on `orderFormTemplate` and the certificate imported them from
 * there. That was fine while the dependency ran one way; it stopped being
 * fine when the order form began carrying the certificate as one of its
 * pages, which would have made the two modules import each other. A cycle of
 * function-level imports happens to work, and quietly stops working the day
 * either module reads the other at load time.
 */

export function esc(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtDate(d?: string | Date | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB"); // dd/mm/yyyy — matches the footer's own date format
}

export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

let fontFacesCache: string | null = null;
/** Self-hosted Thmanyah Sans, inlined as base64 so the headless render needs
 *  no filesystem/network reach beyond this one read — Chrome and the
 *  Puppeteer/Playwright PDF path then rasterize from the exact same bytes. */
export function fontFaces(): string {
  if (fontFacesCache) return fontFacesCache;
  const dir = path.join(process.cwd(), "public", "fonts");
  const weights: [string, number][] = [
    ["thmanyahsans-Regular.woff2", 400],
    ["thmanyahsans-Medium.woff2", 500],
    ["thmanyahsans-Bold.woff2", 700],
    ["thmanyahsans-Black.woff2", 900],
  ];
  const faces = weights
    .map(([file, weight]) => {
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) return "";
      const b64 = fs.readFileSync(p).toString("base64");
      return `@font-face{font-family:"Thmanyah";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${weight};font-display:swap;}`;
    })
    .filter(Boolean)
    .join("\n");
  fontFacesCache = faces;
  return faces;
}
