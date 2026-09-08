import mongoose from "mongoose";
import { connectDB } from "@/lib/mongoose";
import Notification from "@/models/Notification";
import User from "@/models/User";
import { pushToUser } from "@/lib/sseClients";

interface SampleLike {
  _id: mongoose.Types.ObjectId;
  sampleNumber: string;
  product?: string;
  customer?: string;
}

/**
 * A sample came back out of range. Notify the people whose job it is: the lab,
 * the technical manager, and admins. A "warning" does NOT raise this — it is
 * still inside the accepted range, just close to a limit.
 */
export async function notifyLabFail(sample: SampleLike) {
  await connectDB();

  const recipients = (await User.find({
    isActive: true,
    role: { $in: ["admin", "lab_technician", "technical_manager"] },
  })
    .select("_id")
    .lean()) as { _id: mongoose.Types.ObjectId }[];

  if (!recipients.length) return;

  const where = [sample.product, sample.customer].filter(Boolean).join(" — ");

  await Promise.all(
    recipients.map((r) =>
      Notification.create({
        userId: r._id,
        type: "lab_fail",
        title: "Sample out of range",
        titleAr: "عيّنة خارج النطاق",
        message: `${sample.sampleNumber}${where ? ` · ${where}` : ""}`,
        messageAr: `${sample.sampleNumber}${where ? ` · ${where}` : ""}`,
        labSampleId: sample._id,
        isRead: false,
      })
        .then(() => pushToUser(r._id.toString()))
        .catch((err) => console.error("[notifyLabFail]", err))
    )
  );
}
