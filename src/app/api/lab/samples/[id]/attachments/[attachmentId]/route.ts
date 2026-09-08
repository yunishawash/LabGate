import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { requireRole } from "@/lib/requireSession";
import { badRequest, notFound, oid } from "@/lib/apiHelpers";
import LabSample from "@/models/LabSample";
import { deleteLabAttachmentFile } from "@/lib/labUpload";

/** Unauthenticated in the CMMS, and it reported success even when nothing was
 *  deleted. Both fixed. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  await connectDB();
  const check = await requireRole("lab_technician", "technical_manager");
  if (check.error) return check.error;

  const { id, attachmentId } = await params;
  if (!oid(id) || !oid(attachmentId)) return badRequest("Invalid id");

  const sample = await LabSample.findOne({ _id: id, isActive: true });
  if (!sample) return notFound("Sample not found");

  const attachment = sample.attachments.id(attachmentId);
  if (!attachment) return notFound("Attachment not found");

  const url = attachment.url;
  attachment.deleteOne();
  await sample.save();

  // Best-effort: the record is the source of truth, a stray file on disk is not
  // worth failing the request over.
  await deleteLabAttachmentFile(url);

  return NextResponse.json({ success: true, attachments: sample.attachments });
}
