/**
 * Rejects and closes every order that has sat Pending at its current stage
 * for more than 48 hours (`LATE_HOURS`, src/lib/aging.ts) with no action
 * taken — the client's own rule (2026-10-12): a held order stops being
 * "busy" and starts being "forgotten" at that point, and nobody should have
 * to notice and reject it by hand.
 *
 * The rejection is recorded under the SYSTEM's own authority, not an
 * admin's: `rejection.byName` prints as "النظام", not a person's name, and
 * the reason is the fixed text in src/lib/autoReject.ts — never free-typed.
 * See that file for the actual logic; this is just the CLI wrapper.
 *
 * Defaults to a DRY RUN — it only prints what it would reject. Nothing is
 * rejected until --yes is passed.
 *
 *   npx tsx src/scripts/auto-reject-stuck-orders.ts          # dry run
 *   npx tsx src/scripts/auto-reject-stuck-orders.ts --yes    # do it
 *
 * Meant to run on a schedule (every 15–30 min is plenty, against a 48h
 * threshold) via the server's own crontab — see DEPLOY_PM2.md §5 for where
 * the backup cron already lives; add this alongside it. This script does
 * NOT install that cron entry itself.
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });
import { connectDB } from "../lib/mongoose";
import { autoRejectStuckOrders } from "../lib/autoReject";

const APPLY = process.argv.includes("--yes");

async function main() {
  await connectDB();

  const { candidates, rejectedCount } = await autoRejectStuckOrders({ dryRun: !APPLY });

  if (!candidates.length) {
    console.log("No order has been stuck past the 48h threshold. Nothing to do.");
    process.exit(0);
  }

  console.log(
    `${candidates.length} order(s) past 48h with no action:\n`
  );
  for (const c of candidates) {
    console.log(
      `  ${c.orderNumber}  ${c.customerAr || c.customer || "—"}  ` +
      `stuck at: ${c.stageRole || "?"}  (${c.hoursStuck}h)`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing rejected. Re-run with --yes to reject and close ${candidates.length} order(s).`);
  } else {
    console.log(`\nRejected and closed ${rejectedCount} of ${candidates.length} order(s).`);
    if (rejectedCount < candidates.length) {
      console.log(`${candidates.length - rejectedCount} had already moved on since the scan — left alone.`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[auto-reject-stuck-orders] failed:", err);
  process.exit(1);
});
