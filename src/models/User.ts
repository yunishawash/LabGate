import mongoose, { Schema, Document } from "mongoose";
import { USER_ROLES } from "@/types";

export interface IUserDoc extends Document {
  name: string;
  nameAr?: string;
  email: string;
  password?: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  /** Absence is what unlocks a deputy's signature on the approval chain
   *  (SPEC §8.2). Every change to it is audited — it moves authority. */
  isAbsent: boolean;
  absentFrom?: Date | null;
  absentTo?: Date | null;
  absenceNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDoc>(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: "" },
    role: { type: String, enum: USER_ROLES, default: "sales_coordinator" },
    permissions: [{ type: String }],
    isActive: { type: Boolean, default: true },
    isAbsent: { type: Boolean, default: false },
    absentFrom: { type: Date, default: null },
    absentTo: { type: Date, default: null },
    absenceNote: { type: String, default: "" },
  },
  { timestamps: true }
);

// "Which stage is this user's role, and are they here?" — the query behind
// every deputy check (SPEC §8.2).
UserSchema.index({ role: 1, isActive: 1, isAbsent: 1 });

// NOTE: deliberately NO pre-save hook. Passwords are hashed manually with
// bcryptjs cost 12 in every caller. A hook here would double-hash whenever a
// document is saved twice — the bug that made the CMMS remove its own.
// Never call user.save() after changing `password`; use findByIdAndUpdate.

export default mongoose.models.User || mongoose.model<IUserDoc>("User", UserSchema);
