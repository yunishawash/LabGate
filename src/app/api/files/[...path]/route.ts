import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import { requireSession } from "@/lib/requireSession";
import { resolveUploadPath } from "@/lib/labUpload";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf",
  ".csv": "text/csv", ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Serves QC attachments from UPLOAD_DIR.
 *
 * These files are NOT under `public/` — that is the whole point (SPEC §16): a
 * rebuild or a container swap would discard them, and `mongodump` never carried
 * them anyway. The trade is that serving them becomes our job, which is an
 * improvement: static files were readable by anyone who guessed a URL, and
 * these require a session.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const check = await requireSession();
  if (check.error) return check.error;

  const { path: segments } = await params;
  // resolveUploadPath refuses anything that escapes the root, so "../../etc"
  // returns 400 rather than reading the filesystem.
  const full = resolveUploadPath(segments.join("/"));
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const info = await stat(full);
    if (!info.isFile()) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const buffer = await readFile(full);
    const type = TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(info.size),
        // Private: these are customer QC records, never cached by a proxy.
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${path.basename(full)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
