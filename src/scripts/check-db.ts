/**
 * Smoke test for the database connection: writes, reads back, deletes.
 * A write failing here means the server is not a writable primary — see
 * SPEC §19.1 before debugging anything else.
 *
 *   npm run check:db
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";

async function main() {
  await connectDB();
  const { host, port, name } = mongoose.connection;
  console.log(`connected  ${host}:${port}/${name}`);

  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  console.log(`writable   ${hello.isWritablePrimary === true}`);
  console.log(`replicaSet ${hello.setName ?? "(standalone)"}`);

  const col = mongoose.connection.collection("__smoketest");
  const { insertedId } = await col.insertOne({ at: new Date(), note: "labgate smoke test" });
  const found = await col.findOne({ _id: insertedId });
  await col.deleteOne({ _id: insertedId });
  console.log(`write+read ${found ? "OK" : "FAILED"}  (${insertedId})`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
