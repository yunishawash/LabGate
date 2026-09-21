import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

/**
 * QC attachments (COA scans, sample photos) on local disk.
 *
 * ⚠️ REWRITTEN from the CMMS version, deliberately. That one wrote into
 * `public/uploads/lab/…` and let Next serve the files statically. Two problems
 * that only appear later, when they are expensive (SPEC §16):
 *
 *   1. `mongodump` does not carry them. Restore the database on a new server
 *      and every attachment URL 404s — silently, with no error anywhere.
 *   2. `public/` is a build artifact. Under `output: "standalone"`, in a
 *      container, or on any redeploy that rebuilds, anything written there at
 *      runtime is discarded.
 *
 * So: files live OUTSIDE the app tree under UPLOAD_DIR (a mounted volume in
 * production) and are served by an authenticated route handler, never
 * statically. Moving the app becomes `rsync $UPLOAD_DIR`.
 */
// The `turbopackIgnore` comment stops the build tracer from following this
// path.join into a "trace the whole project" warning — this branch is only a
// dev-convenience default; every real deployment sets UPLOAD_DIR (SPEC §16).
const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "..", "labgate-uploads");

export interface SavedAttachment {
  fileName: string;
  /** App-relative URL served by GET /api/files/[...path] — never a disk path. */
  url: string;
  fileType: string;
  size: number;
  uploadedAt: Date;
}

/**
 * Strip anything that isn't a safe filename character. Defends against path
 * traversal ("..", "/") and odd characters from arbitrary client input.
 */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.slice(-100) || "file";
}

/**
 * Resolve a stored relative path to a real one, refusing anything that escapes
 * UPLOAD_ROOT. Every read and delete goes through this — the CMMS's delete
 * built its path from the stored URL with only a leading-slash strip and no
 * containment check at all.
 */
export function resolveUploadPath(relative: string): string | null {
  const root = path.resolve(UPLOAD_ROOT);
  const full = path.resolve(root, relative.replace(/^\/+/, ""));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Save one uploaded file under this sample's own folder.
 *
 * Takes an already-read `buffer` rather than reading `file.arrayBuffer()`
 * itself: the caller must read the bytes anyway to run `validateUpload`
 * below, and a 25 MB file is worth reading once, not twice.
 */
export async function saveLabAttachment(
  sampleId: string,
  file: { name: string; type: string; size: number },
  buffer: Buffer
): Promise<SavedAttachment> {
  const relDir = path.join("lab", sampleId);
  const dir = resolveUploadPath(relDir);
  if (!dir) throw new Error("Refusing to write outside the upload root");
  await mkdir(dir, { recursive: true });

  const safeName = sanitizeFileName(file.name || "file");
  const storedName = `${randomUUID()}-${safeName}`;
  await writeFile(path.join(dir, storedName), buffer);

  return {
    fileName: file.name || safeName,
    url: `/api/files/lab/${sampleId}/${storedName}`,
    fileType: file.type || "",
    size: file.size,
    uploadedAt: new Date(),
  };
}

// ── Content sniffing ─────────────────────────────────────────────────────
//
// The upload route used to trust the browser-supplied MIME type alone. Two
// ways that goes wrong: a file dragged from some file managers arrives with
// an EMPTY `type`, which failed the allowlist for no good reason, and a
// renamed `.exe` arrives with a chosen `type` and no real check on it at all.
// This checks the file's own first bytes instead, for every format that has
// a magic number. Plain text (csv/txt) has none — those fall back to a
// "does this look like binary garbage" sanity check.

export type SniffedKind =
  | "pdf" | "image" | "zip-office" | "ole-office" | "text" | "unknown";

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean => {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
};

const asciiAt = (buf: Buffer, offset: number, text: string): boolean =>
  buf.length >= offset + text.length &&
  buf.subarray(offset, offset + text.length).toString("latin1") === text;

/** Identify a file by its own bytes, ignoring whatever name or MIME type it
 *  was uploaded with. */
export function sniffKind(buffer: Buffer): SniffedKind {
  if (asciiAt(buffer, 0, "%PDF-")) return "pdf";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image"; // PNG
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image"; // JPEG
  if (asciiAt(buffer, 0, "GIF87a") || asciiAt(buffer, 0, "GIF89a")) return "image"; // GIF
  if (asciiAt(buffer, 0, "BM")) return "image"; // BMP
  if (asciiAt(buffer, 0, "RIFF") && asciiAt(buffer, 8, "WEBP")) return "image"; // WEBP
  // HEIC/HEIF (iPhone photos): an ISO base media "ftyp" box naming a heic/heif
  // brand at byte 8 — the container format is the same one MP4 uses, so the
  // brand is what actually says "this is a photo, not a video".
  if (asciiAt(buffer, 4, "ftyp") && /^(heic|heix|hevc|hevx|mif1|msf1)/.test(buffer.subarray(8, 12).toString("latin1"))) {
    return "image";
  }
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "zip-office"; // .xlsx (and any zip-based Office format)
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole-office"; // legacy .xls
  // No magic number of its own — call it text only if it doesn't look binary:
  // a NUL byte in the first chunk is not something a genuine .csv/.txt has.
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  if (!sample.includes(0)) return "text";
  return "unknown";
}

export interface UploadValidation {
  ok: boolean;
  /** Bilingual — this is shown to the user verbatim, per file. */
  reason?: { en: string; ar: string };
}

/**
 * Does this file's ACTUAL content belong to one of the types the attachments
 * route allows? `fileName`'s extension only matters for the two zip/OLE-based
 * Office formats, which share a container with several other formats and are
 * otherwise indistinguishable by bytes alone.
 */
export function validateUpload(buffer: Buffer, fileName: string): UploadValidation {
  const kind = sniffKind(buffer);
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

  const acceptedByKind: Record<SniffedKind, boolean> = {
    pdf: true,
    image: true,
    text: ext === "csv" || ext === "txt" || ext === "", // plain text with no name is still plausibly a paste-saved note
    "zip-office": ext === "xlsx",
    "ole-office": ext === "xls",
    unknown: false,
  };

  if (acceptedByKind[kind]) return { ok: true };

  return {
    ok: false,
    reason: {
      en: "This file's content doesn't match an accepted type (image, PDF, spreadsheet or text file).",
      ar: "محتوى هذا الملف لا يطابق نوعاً مقبولاً (صورة، PDF، جدول بيانات، أو ملف نصي).",
    },
  };
}

/**
 * Best-effort delete of the file behind an attachment. A missing file (already
 * removed, disk cleaned) is not an error worth surfacing — but a path that
 * escapes the root is, and is refused rather than ignored.
 */
export async function deleteLabAttachmentFile(url: string): Promise<void> {
  const relative = url.replace(/^\/api\/files\//, "");
  const full = resolveUploadPath(relative);
  if (!full) return;
  try {
    await unlink(full);
  } catch {
    // already gone
  }
}

export { UPLOAD_ROOT };
