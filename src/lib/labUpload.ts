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
const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || path.join(process.cwd(), "..", "labgate-uploads");

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

/** Save one uploaded File under this sample's own folder. */
export async function saveLabAttachment(
  sampleId: string,
  file: File
): Promise<SavedAttachment> {
  const relDir = path.join("lab", sampleId);
  const dir = resolveUploadPath(relDir);
  if (!dir) throw new Error("Refusing to write outside the upload root");
  await mkdir(dir, { recursive: true });

  const safeName = sanitizeFileName(file.name || "file");
  const storedName = `${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, storedName), buffer);

  return {
    fileName: file.name || safeName,
    url: `/api/files/lab/${sampleId}/${storedName}`,
    fileType: file.type || "",
    size: file.size,
    uploadedAt: new Date(),
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
