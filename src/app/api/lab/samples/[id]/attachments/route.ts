import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import { saveLabAttachment } from "@/lib/labUpload";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per file
const ALLOWED = [
  "image/", "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel", "text/csv", "text/plain",
];

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
  if (!files.length) return badRequest("No files were uploaded");

  for (const file of files) {
    if (file.size > MAX_BYTES) return badRequest(`${file.name} is larger than 25 MB`);
    // A type allowlist the CMMS did not have — this endpoint accepted anything.
    if (!ALLOWED.some((t) => (file.type || "").startsWith(t))) {
      return badRequest(`${file.name}: only images, PDFs, spreadsheets and text files are accepted`);
    }
  }

  for (const file of files) {
    const saved = await saveLabAttachment(id, file);
    sample.attachments.push({
      ...saved,
      uploadedById: userDoc._id,
      uploadedByName: userDoc.name,
    });
  }
  await sample.save();

  return NextResponse.json({ attachments: sample.attachments }, { status: 201 });
}
