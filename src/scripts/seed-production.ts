/**
 * Production seed.
 *
 * Deliberately NOT `seed.ts` with a flag. The development seed writes a known
 * password onto nine accounts, and the one thing that must never happen is that
 * script being run against the plant server out of habit. Two files, two names,
 * no shared switch to get wrong.
 *
 * What this does:
 *   · creates the nine chain accounts if they are missing
 *   · gives each a DIFFERENT random password, printed once, never stored
 *   · refuses to touch an account that already exists
 *   · refuses to run at all against a database that already holds orders
 *
 *   npm run seed:prod          # create missing accounts
 *   npm run seed:prod -- --check   # report only, change nothing
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { connectDB } from "../lib/mongoose";

interface SeedUser {
  name: string; nameAr: string; email: string; role: string; permissions: string[];
}

const USERS: SeedUser[] = [
  { name: "Administrator",     nameAr: "مدير النظام",    email: "admin@gwmc.com",         role: "admin",             permissions: ["lab", "orders", "customers", "reports", "users", "audit-log", "health"] },
  { name: "Sales Coordinator", nameAr: "منسّق المبيعات",  email: "sales.coord@gwmc.com",   role: "sales_coordinator", permissions: ["orders"] },
  { name: "Sales Manager",     nameAr: "مدير المبيعات",   email: "sales.manager@gwmc.com", role: "sales_manager",     permissions: ["orders", "customers", "reports"] },
  { name: "Finance Manager",   nameAr: "المدير المالي",   email: "finance@gwmc.com",       role: "finance_manager",   permissions: ["orders", "reports"] },
  { name: "Accounts Officer",  nameAr: "مسؤول الحسابات",  email: "accountant@gwmc.com",    role: "accountant",        permissions: ["orders"] },
  { name: "General Manager",   nameAr: "المدير العام",    email: "gm@gwmc.com",            role: "general_manager",   permissions: ["orders", "customers", "reports", "audit-log"] },
  { name: "Technical Manager", nameAr: "المدير التقني",   email: "tech.manager@gwmc.com",  role: "technical_manager", permissions: ["orders", "lab", "reports"] },
  { name: "Lab Technician",    nameAr: "فني المختبر",     email: "lab.tech@gwmc.com",      role: "lab_technician",    permissions: ["orders", "lab"] },
  { name: "Weighbridge",       nameAr: "مشغّل الميزان",   email: "weighbridge@gwmc.com",   role: "weighbridge",       permissions: ["orders"] },
];

/**
 * A password a person can read over the phone once and type correctly, with
 * enough entropy that guessing it is not a strategy. No ambiguous characters —
 * `l/1/I` and `O/0` cause a support call on the first day.
 */
function password(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  await connectDB();
  const User = (await import("../models/User")).default;
  const SalesOrder = (await import("../models/SalesOrder")).default;

  const orders = await SalesOrder.countDocuments();
  const existing = await User.countDocuments();

  console.log(`database: ${mongoose.connection.name}`);
  console.log(`users already present: ${existing} · orders: ${orders}\n`);

  /**
   * A live database is one that has done work. Seeding into it risks creating a
   * second "Finance Manager" beside the real one — two accounts holding the same
   * stage, with signatures split between them.
   */
  if (orders > 0 && !process.argv.includes("--i-know-this-database-has-orders")) {
    console.error(
      `REFUSING: this database already holds ${orders} order(s), so it is not a fresh install.\n` +
      `Create the missing people through the Users screen instead — it audits what it does.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const created: { email: string; password: string }[] = [];
  const skipped: string[] = [];

  for (const u of USERS) {
    const found = await User.findOne({ email: u.email }).select("_id").lean();
    if (found) {
      // Never rewrite an existing account. Its password may have been changed
      // by its owner, and its role may have been adjusted deliberately.
      skipped.push(u.email);
      continue;
    }
    if (checkOnly) {
      created.push({ email: u.email, password: "(would be created)" });
      continue;
    }
    const pw = password();
    await User.create({
      name: u.name, nameAr: u.nameAr, email: u.email,
      password: await bcrypt.hash(pw, 12),
      role: u.role, permissions: u.permissions, isActive: true,
    });
    created.push({ email: u.email, password: pw });
  }

  if (skipped.length) {
    console.log(`untouched (already exist): ${skipped.length}`);
    for (const e of skipped) console.log(`  · ${e}`);
    console.log();
  }

  if (!created.length) {
    console.log("Nothing to create — every account is already present.");
  } else if (checkOnly) {
    console.log(`--check: ${created.length} account(s) WOULD be created:`);
    for (const c of created) console.log(`  · ${c.email}`);
  } else {
    console.log("─".repeat(64));
    console.log("CREATED — these passwords are shown ONCE and are not recoverable.");
    console.log("Write them down now, hand each to its owner, and have them changed.");
    console.log("─".repeat(64));
    for (const c of created) console.log(`  ${c.email.padEnd(32)} ${c.password}`);
    console.log("─".repeat(64));
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
