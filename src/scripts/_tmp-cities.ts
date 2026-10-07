import "dotenv/config"; import fs from "fs"; import mongoose from "mongoose";
import { connectDB } from "../lib/mongoose";
import City from "../models/City"; import LabCustomer from "../models/LabCustomer";
async function main() {
  await connectDB();
  const mode = process.argv[2];
  const FILE = "/tmp/claude-501/-Users-yunis-Projects-LabGate/02bffff3-71a0-4e3c-8217-a149cdf66bf8/scratchpad/revert2.json";
  if (mode === "set") {
    const cities = (await City.find({ isActive: true }).select("name").lean()) as any[];
    const demos = (await LabCustomer.find({ isActive: true, $or: [{ customerNo: { $exists: false } }, { customerNo: "" }] }).select("cityId").lean()) as any[];
    fs.writeFileSync(FILE, JSON.stringify(demos.map((d) => ({ id: String(d._id), cityId: d.cityId ? String(d.cityId) : null }))));
    for (let i = 0; i < demos.length; i++)
      await LabCustomer.updateOne({ _id: demos[i]._id }, { $set: { cityId: cities[i % cities.length]._id } });
    console.log(`temporarily assigned ${demos.length}`);
  } else {
    const before = JSON.parse(fs.readFileSync(FILE, "utf8")) as { id: string; cityId: string | null }[];
    for (const r of before) await LabCustomer.updateOne({ _id: r.id }, { $set: { cityId: r.cityId } });
    const left = await LabCustomer.countDocuments({ isActive: true, cityId: { $ne: null }, $or: [{ customerNo: { $exists: false } }, { customerNo: "" }] });
    console.log(`reverted ${before.length}; demo rows still holding a city: ${left}`);
  }
  await mongoose.disconnect();
}
main();
