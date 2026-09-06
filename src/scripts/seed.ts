/**
 * seed.ts — one account per role in the approval chain, so the eight stages can
 * be walked end to end before real users exist.
 *
 * Idempotent: upserts on email. Role and permissions are re-synced on every
 * run so a change here reaches an existing account; the password is written
 * ONLY on insert, so a password someone has since changed is never clobbered.
 *
 * Passwords are hashed manually with bcrypt cost 12 — User.ts has no pre-save
 * hook, by design (SPEC §4).
 *
 *   npm run seed
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../lib/mongoose";

const DEFAULT_PASSWORD = "pass123";

interface SeedUser {
  name: string;
  nameAr: string;
  email: string;
  role: string;
  permissions: string[];
}

/**
 * Every chain role needs the `lab` module permission — the whole workflow lives
 * under it. WHICH STAGE each of them may act on is enforced by the API from the
 * stage table, never from this list.
 */
const USERS: SeedUser[] = [
  { name: "Administrator",    nameAr: "مدير النظام",     email: "admin@gwmc.com",           role: "admin",             permissions: ["lab", "orders", "customers", "reports", "users", "audit-log", "health"] },
  { name: "Sales Coordinator", nameAr: "منسّق المبيعات",  email: "sales.coord@gwmc.com",     role: "sales_coordinator", permissions: ["orders"] },
  { name: "Sales Manager",     nameAr: "مدير المبيعات",   email: "sales.manager@gwmc.com",   role: "sales_manager",     permissions: ["orders", "customers", "reports"] },
  { name: "Finance Manager",   nameAr: "المدير المالي",   email: "finance@gwmc.com",         role: "finance_manager",   permissions: ["orders", "reports"] },
  { name: "Accounts Officer",  nameAr: "مسؤول الحسابات",  email: "accountant@gwmc.com",      role: "accountant",        permissions: ["orders"] },
  { name: "General Manager",   nameAr: "المدير العام",    email: "gm@gwmc.com",              role: "general_manager",   permissions: ["orders", "customers", "reports", "audit-log"] },
  { name: "Technical Manager", nameAr: "المدير التقني",   email: "tech.manager@gwmc.com",    role: "technical_manager", permissions: ["orders", "lab", "reports"] },
  { name: "Lab Technician",    nameAr: "فني المختبر",     email: "lab.tech@gwmc.com",        role: "lab_technician",    permissions: ["orders", "lab"] },
  { name: "Weighbridge",       nameAr: "مشغّل الميزان",   email: "weighbridge@gwmc.com",     role: "weighbridge",       permissions: ["orders"] },
];

async function main() {
  await connectDB();
  const User = (await import("../models/User")).default;

  const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  for (const u of USERS) {
    const res = await User.updateOne(
      { email: u.email },
      {
        $set: {
          name: u.name,
          nameAr: u.nameAr,
          role: u.role,
          permissions: u.permissions,
          isActive: true,
        },
        $setOnInsert: {
          email: u.email,
          password: hashed,
          isAbsent: false,
          absentFrom: null,
          absentTo: null,
          absenceNote: "",
        },
      },
      { upsert: true }
    );
    const what = res.upsertedCount ? "created" : "updated";
    console.log(`  ${what.padEnd(7)} ${u.email.padEnd(28)} ${u.role}`);
  }

  console.log(`\n${USERS.length} accounts ready. Password for all: ${DEFAULT_PASSWORD}`);
  console.log("Rotate every one of these before production (SPEC §19.7).");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
