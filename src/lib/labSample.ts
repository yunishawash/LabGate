import LabSample from "@/models/LabSample";

/**
 * Create a LabSample with a unique, auto-sequenced sampleNumber
 * (LAB-<year>-<seq>). Same race-safe pattern as src/lib/report.ts's
 * createReport() — countDocuments()+1 would let two concurrent requests
 * race to insert the same number and collide on the unique index. Instead
 * this finds the highest existing number for the current year and retries
 * on a duplicate-key collision (E11000).
 */
export async function createLabSample(
  data: Record<string, unknown>,
  maxRetries = 10
): Promise<InstanceType<typeof LabSample>> {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const latest = await LabSample
      .findOne({ sampleNumber: { $regex: `^LAB-${year}-` } }, { sampleNumber: 1 })
      .sort({ sampleNumber: -1 })
      .lean() as { sampleNumber?: string } | null;

    let seq = 1;
    if (latest?.sampleNumber) {
      const m = String(latest.sampleNumber).match(/(\d+)$/);
      if (m) seq = parseInt(m[1]) + 1;
    }

    const sampleNumber = `LAB-${year}-${String(seq).padStart(4, "0")}`;

    try {
      return await LabSample.create({ ...data, sampleNumber });
    } catch (err: unknown) {
      const mongoErr = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (mongoErr.code === 11000 && mongoErr.keyPattern?.sampleNumber && attempt < maxRetries - 1) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to allocate a unique sample number after ${maxRetries} attempts`);
}
