import mongoose from "mongoose";

/**
 * Standalone mongod — NOT a replica set. Nothing in LabGate uses a
 * multi-document transaction (the atomic transitions in SPEC §8.3 are built
 * from single-document conditional updates precisely so none is needed), so a
 * replica set buys nothing and costs the `not primary` failure mode every time
 * it fails over to a node the host cannot resolve. See SPEC §19.1.
 */
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27020/labgate";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache;
}

const cached: MongooseCache = global.mongooseCache || { conn: null, promise: null };
global.mongooseCache = cached;

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    // Clear the cached promise on failure, so a first connect that failed
    // (Mongo not up yet at server start) retries fresh on the next call
    // instead of replaying the same rejection forever.
    cached.promise = mongoose
      .connect(MONGODB_URI)
      .then((m) => m)
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
