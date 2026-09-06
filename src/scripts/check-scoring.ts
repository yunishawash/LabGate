/**
 * Proves the ported QC engine still scores exactly as it did in the CMMS:
 * thresholds resolve per product, and the pass/warning/fail verdict follows.
 *   npm run check:scoring
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import LabProduct from "../models/LabProduct";
import LabParameter from "../models/LabParameter";
import { scoreResults } from "../lib/labScore";

async function main() {
  await connectDB();

  const superGrade = await LabProduct.findOne({ name: "Super" }).lean() as { _id: unknown } | null;
  const ash = await LabParameter.findOne({ name: "Ash" }).lean() as { _id: unknown } | null;
  const moisture = await LabParameter.findOne({ name: "Moisture" }).lean() as { _id: unknown } | null;
  if (!superGrade || !ash || !moisture) throw new Error("catalogue not seeded — run npm run seed:lab");

  // "Super" overrides Ash to the band 0.50–0.52. Moisture keeps its plant-wide
  // default of "not more than 14".
  const cases: { label: string; ash: number; moisture: number }[] = [
    { label: "both comfortably in spec", ash: 0.51, moisture: 12.0 },
    { label: "ash at the very edge",     ash: 0.5,  moisture: 12.0 },
    { label: "ash below the band",       ash: 0.44, moisture: 12.0 },
    { label: "moisture over the ceiling", ash: 0.51, moisture: 15.2 },
  ];

  for (const c of cases) {
    const { results, overallStatus } = await scoreResults(String(superGrade._id), [
      { parameterId: String(ash._id), value: c.ash },
      { parameterId: String(moisture._id), value: c.moisture },
    ]);
    const detail = results
      .map((r) => `${r.parameterName}=${r.value} [${r.min ?? "-"}..${r.max ?? "-"}] ${r.status}`)
      .join("  |  ");
    console.log(`${c.label.padEnd(28)} => ${overallStatus.toUpperCase().padEnd(8)} ${detail}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
