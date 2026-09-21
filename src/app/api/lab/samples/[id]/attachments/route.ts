import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import { saveLabAttachment, validateUpload } from "@/lib/labUpload";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file

/**
 * A 400 with BOTH languages of the message. Every other route in this app
 * returns `{ error }` in English only and the client shows it verbatim — a
 * known gap (SPEC follow-up), fixed one route at a time rather than by a
 * blanket rewrite of `badRequest()`. This route is small enough to do
 * properly now; `SampleDialog` picks whichever field matches its language.
 */
const badRequestBilingual = (en: string, ar: string) =>
  NextResponse.json({ error: en, errorAr: ar }, { status: 400 });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;
  const { userDoc } = check;

  const { id } = await params;
  if (!oid(id)) return badRequest("Invalid id");

  const sample = await LabSample.findOne({ _id: id, isActive: true });
  if (!sample) return notFound("Sample not found");

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return badRequestBilingual("No files were uploaded", "لم يتم اختيار أي ملف");
  }

  // Validate the WHOLE batch, and read every buffer, before writing anything —
  // one bad file must not leave the good ones written and the sample half
  // updated. `sniffKind`/`validateUpload` (src/lib/labUpload.ts) check the
  // file's own bytes rather than trusting the browser-supplied MIME type:
  // that type is EMPTY for files dragged from some file managers (which used
  // to fail here for no reason) and is trivially spoofable in the other
  // direction (a renamed .exe used to pass with no check at all).
  const buffers: Buffer[] = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      return badRequestBilingual(
        `${file.name} is larger than the 25 MB limit.`,
        `الملف "${file.name}" أكبر من الحد المسموح به (25 ميغابايت).`
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateUpload(buffer, file.name || "");
    if (!validation.ok) {
      return badRequestBilingual(
        `${file.name}: ${validation.reason!.en}`,
        `"${file.name}": ${validation.reason!.ar}`
      );
    }
    buffers.push(buffer);
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const saved = await saveLabAttachment(
      id,
      { name: file.name, type: file.type, size: file.size },
      buffers[i]
    );
    sample.attachments.push({
      ...saved,
      uploadedById: userDoc._id,
      uploadedByName: userDoc.name,
    });
  }
  await sample.save();

  return NextResponse.json({ attachments: sample.attachments }, { status: 201 });
}
