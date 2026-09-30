/**
 * Reset one account's password — for when it's lost, not for routine use.
 * `seed-production.ts` never overwrites an existing account's password on
 * purpose (SPEC-level rule: it may have been changed by its owner); this is
 * the deliberate, one-off escape hatch for that case.
 *
 * Runs against whatever `MONGODB_URI` is in `.env.local` in the current
 * directory — same as every other script here. On the plant server that's
 * production; run it from `/opt/LabGate`, not a laptop, unless a dev/local
 * reset is genuinely what's wanted.
 *
 *   npm run reset:password -- admin@gwmc.com                # random password, printed once
 *   npm run reset:password -- admin@gwmc.com --password=Xy9kLmP2Qr7s   # set a specific one
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { connectDB } from "../lib/mongoose";

/** Same generator as `seed-production.ts` — no `l/1/I` or `O/0`, the pair
 *  that turns into a support call the moment someone reads it off a note. */
function randomPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"))?.toLowerCase().trim();
  const explicit = args.find((a) => a.startsWith("--password="))?.slice("--password=".length);

  if (!email) {
    console.error(
      "Usage: npm run reset:password -- <email> [--password=<value>]\n" +
      "  no --password  → a random one is generated and printed once\n" +
      "  --password=... → sets that exact value instead"
    );
    process.exit(1);
  }

  await connectDB();
  console.log(`database: ${mongoose.connection.name}`);
  const User = (await import("../models/User")).default;

  const user = await User.findOne({ email }).select("_id email name isActive").lean();
  if (!user) {
    console.error(`No account found for ${email}.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const pw = explicit ?? randomPassword();
  // Never `.save()` a password change — see the comment on User.ts: there's
  // no pre-save hash hook by design, so a direct update is the only path
  // that can't accidentally double-hash it.
  await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(pw, 12) } });

  console.log("─".repeat(64));
  console.log(`Password reset for ${user.email} (${user.name}).`);
  if (!explicit) console.log("This is shown ONCE and is not recoverable — write it down now.");
  console.log(`  ${pw}`);
  console.log("─".repeat(64));
  if (!user.isActive) console.log("Note: this account is currently inactive.");

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
