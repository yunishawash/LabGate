/**
 * Clears dev/demo activity so a database that has been played with locally
 * (`npm run seed`, `npm run seed:lab`, `seed-demo-orders.ts`, `walk-ui.mjs`…)
 * can be handed to `seed-production.ts`, which refuses to run at all once any
 * order exists.
 *
 * Removes: orders, lab samples, audit log entries, notifications, and the
 * order-numbering counters (so real orders start again at 1).
 *
 * Deliberately NOT removed, even with --yes: users, customers, lab
 * parameters/thresholds/products. Those are configuration, not "dump" data —
 * wiping them by accident is a much worse afternoon than a stray demo order.
 * Delegations are left alone too, since a delegation can be a real,
 * deliberately-created record rather than test noise; pass
 * --include-delegations if this database's delegations are known to be demo
 * data as well.
 *
 * Defaults to a DRY RUN — it only prints what it would do. Nothing is deleted
 * until --yes is passed.
 *
 *   npx tsx src/scripts/clear-demo-data.ts                          # dry run
 *   npx tsx src/scripts/clear-demo-data.ts --yes                    # do it
 *   npx tsx src/scripts/clear-demo-data.ts --yes --include-delegations
 *   npx tsx src/scripts/clear-demo-data.ts --yes --keep-counters    # leave order numbering as-is
 *   npx tsx src/scripts/clear-demo-data.ts --yes --wipe-uploads     # also delete files under UPLOAD_DIR/lab
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";
import { rm } from "node:fs/promises";
import path from "node:path";
import { connectDB } from "../lib/mongoose";

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--yes");
const INCLUDE_DELEGATIONS = ARGV.includes("--include-delegations");
const KEEP_COUNTERS = ARGV.includes("--keep-counters");
const WIPE_UPLOADS = ARGV.includes("--wipe-uploads");

async function main() {
  await connectDB();

  const SalesOrder = (await import("../models/SalesOrder")).default;
  const LabSample = (await import("../models/LabSample")).default;
  const AuditLog = (await import("../models/AuditLog")).default;
  const Notification = (await import("../models/Notification")).default;
  const Delegation = (await import("../models/Delegation")).default;
  const Counter = (await import("../models/Counter")).default;
  const User = (await import("../models/User")).default;
  const LabCustomer = (await import("../models/LabCustomer")).default;

  console.log(`database: ${mongoose.connection.name}`);
  console.log(APPLY ? "mode: LIVE — this will delete data\n" : "mode: dry run — nothing will be changed\n");

  const counts = {
    orders: await SalesOrder.countDocuments(),
    labSamples: await LabSample.countDocuments(),
    auditLog: await AuditLog.countDocuments(),
    notifications: await Notification.countDocuments(),
    delegations: await Delegation.countDocuments(),
    orderCounters: await Counter.countDocuments({ _id: /^order-/ }),
  };
  const kept = {
    users: await User.countDocuments(),
    customers: await LabCustomer.countDocuments(),
  };

  console.log("will remove:");
  console.log(`  sales orders      ${counts.orders}`);
  console.log(`  lab samples       ${counts.labSamples}`);
  console.log(`  audit log entries ${counts.auditLog}`);
  console.log(`  notifications     ${counts.notifications}`);
  console.log(`  order counters    ${KEEP_COUNTERS ? "0 (--keep-counters)" : counts.orderCounters}`);
  console.log(`  delegations       ${INCLUDE_DELEGATIONS ? counts.delegations : "0 (pass --include-delegations to remove)"}`);
  console.log("\nleft untouched (config, not dump data):");
  console.log(`  users             ${kept.users}`);
  console.log(`  customers         ${kept.customers}`);
  console.log(`  lab parameters, thresholds, products — never touched by this script`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --yes to actually delete the rows above.");
    await mongoose.disconnect();
    return;
  }

  console.log();
  const rOrders = await SalesOrder.deleteMany({});
  console.log(`  deleted ${rOrders.deletedCount} sales order(s)`);
  const rSamples = await LabSample.deleteMany({});
  console.log(`  deleted ${rSamples.deletedCount} lab sample(s)`);
  const rAudit = await AuditLog.deleteMany({});
  console.log(`  deleted ${rAudit.deletedCount} audit log entr(y/ies)`);
  const rNotif = await Notification.deleteMany({});
  console.log(`  deleted ${rNotif.deletedCount} notification(s)`);

  if (!KEEP_COUNTERS) {
    const rCounters = await Counter.deleteMany({ _id: /^order-/ });
    console.log(`  deleted ${rCounters.deletedCount} order counter(s) — next real order starts at 1`);
  }

  if (INCLUDE_DELEGATIONS) {
    const rDeleg = await Delegation.deleteMany({});
    console.log(`  deleted ${rDeleg.deletedCount} delegation(s)`);
  }

  if (WIPE_UPLOADS) {
    const { UPLOAD_ROOT } = await import("../lib/labUpload");
    const labDir = path.join(UPLOAD_ROOT, "lab");
    await rm(labDir, { recursive: true, force: true });
    console.log(`  removed ${labDir} (attachment files for the deleted samples)`);
  } else if (rSamples.deletedCount > 0) {
    console.log(
      "\nNote: attachment files on disk under UPLOAD_DIR/lab were NOT removed " +
      "(their database records are gone, so they are now orphaned). " +
      "Re-run with --wipe-uploads to delete them too."
    );
  }

  console.log("\nDone. seed-production.ts will now run cleanly against this database.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
