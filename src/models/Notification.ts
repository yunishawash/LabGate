import mongoose, { Schema, Document } from "mongoose";

export interface INotificationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  type: string;
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  salesOrderId?: mongoose.Types.ObjectId | null;
  labSampleId?: mongoose.Types.ObjectId | null;
  isRead: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotificationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Closed enum on purpose: a typo throws at create() rather than producing a
    // notification nothing knows how to render or link.
    type: {
      type: String,
      enum: ["order_pending", "order_rejected", "order_posted", "order_stalled", "lab_fail"],
      required: true,
    },
    // API routes have no locale, so both languages are written at creation time
    // and the client picks at render time.
    title:     { type: String, required: true },
    titleAr:   { type: String, default: "" },
    message:   { type: String, required: true },
    messageAr: { type: String, default: "" },
    salesOrderId: { type: Schema.Types.ObjectId, ref: "SalesOrder", default: null },
    labSampleId:  { type: Schema.Types.ObjectId, ref: "LabSample",  default: null },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: -1 });

export default mongoose.models.Notification ||
  mongoose.model<INotificationDoc>("Notification", NotificationSchema);
