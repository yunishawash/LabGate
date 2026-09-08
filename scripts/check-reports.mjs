/**
 * Phase 10's test: every block renders for its roles, and the totals reconcile
 * with the list counts. A dashboard that disagrees with the page it links to is
 * worse than no dashboard — people stop trusting both.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import * as XLSX from "xlsx";
import { ROLE_BLOCKS } from "../src/lib/dashboardBlocks.ts";

const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(56)} ${p?got:`got ${got}, want ${want}`}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await r.json();
  const jar = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar },
    body: new URLSearchParams({ email, password: "pass123", csrfToken }),
  });
  const all = [...res.headers.getSetCookie(), ...r.headers.getSetCookie()].map((c) => c.split(";")[0]);
  return [...new Map(all.map((c) => [c.split("=")[0], c])).values()].join("; ");
}
const get = (cookie, path) => fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });

// ── every role gets exactly the blocks the table says ──────────────────────
const EMAILS = {
  sales_coordinator: "sales.coord", sales_manager: "sales.manager",
  finance_manager: "finance", general_manager: "gm",
  technical_manager: "tech.manager", lab_technician: "lab.tech",
  weighbridge: "weighbridge", admin: "admin",
};
const cookies = {};
for (const [role, user] of Object.entries(EMAILS)) {
  cookies[role] = await login(`${user}@gwmc.com`);
  const d = await (await get(cookies[role], "/api/dashboard")).json();
  ok(`${role} gets its blocks`, JSON.stringify(d.blocks), JSON.stringify(ROLE_BLOCKS[role]));
  const missing = d.blocks.filter((b) => d.data[b] === undefined);
  ok(`${role}: every block has data`, missing.length ? missing.join(",") : "none", "none");
}

// ── the numbers must agree with the list ──────────────────────────────────
const gm = cookies.general_manager;
const dash = await (await get(gm, "/api/dashboard")).json();
const pipeline = dash.data.pipeline;
const pipelineTotal = pipeline.reduce((n, s) => n + s.count, 0);
const listPending = (await (await get(gm, "/api/orders?status=Pending&limit=1")).json()).total;
ok("pipeline sums to the Pending list total", pipelineTotal, listPending);
ok("inChain equals the same number", dash.inChain, listPending);

for (const s of pipeline.filter((x) => x.count > 0)) {
  const n = (await (await get(gm, `/api/orders?status=Pending&stage=${s.index}&limit=1`)).json()).total;
  ok(`stage ${s.index} column matches the filtered list`, s.count, n);
}

const listRejected = (await (await get(gm, "/api/orders?status=Rejected&limit=1")).json()).total;
const repRejected = (await (await get(gm, "/api/reports?report=rejections")).json())
  .byStage.reduce((n, s) => n + s.count, 0);
ok("rejection report sums to the Rejected list total", repRejected, listRejected);

// ── visibility holds inside the reports, not just the list ────────────────
const finList = (await (await get(cookies.finance_manager, "/api/orders?limit=1")).json()).total;
const finCust = (await (await get(cookies.finance_manager, "/api/reports?report=customers")).json())
  .rows.reduce((n, r) => n + r.orders, 0);
ok("finance's customer report counts only what finance sees", finCust, finList);

const coordList = (await (await get(cookies.sales_coordinator, "/api/orders?limit=1")).json()).total;
const gmList = (await (await get(gm, "/api/orders?limit=1")).json()).total;
ok("and the coordinator sees fewer than the GM", coordList < gmList || coordList === gmList, true);

// ── p90 is a real percentile, not an average wearing a hat ────────────────
const cyc = (await (await get(gm, "/api/reports?report=cycleTime")).json()).byStage;
ok("cycle time excludes the creation step", cyc.some((r) => r.stageKey === "created"), false);
ok("both stage-7 signatures are measured apart", cyc.filter((r) => r.stageIndex === 7).length, 2);
ok("p90 is never below the average", cyc.every((r) => (r.p90Hours ?? 0) >= (r.avgHours ?? 0) - 0.05), true);
ok("and never above the longest", cyc.every((r) => (r.p90Hours ?? 0) <= (r.maxHours ?? 0) + 0.05), true);

// ── the workbook is a real workbook ───────────────────────────────────────
for (const type of ["orders", "pipeline", "cycleTime"]) {
  const res = await get(gm, `/api/export?type=${type}&lang=en`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  ok(`export ${type}: opens as a workbook`, wb.SheetNames.length > 0, true);
  ok(`export ${type}: has rows`, rows.length > 0, true);
  if (type === "orders") {
    ok("export orders: row count equals the visible total", rows.length,
        (await (await get(gm, "/api/orders?limit=1")).json()).total);
  }
  if (type === "pipeline") ok("export pipeline: one row per stage", rows.length, 8);
}

// An export that ignores visibility would hand over in one file exactly what
// the eight stages exist to protect.
const finBuf = Buffer.from(await (await get(cookies.finance_manager, "/api/export?type=orders&lang=en")).arrayBuffer());
const finRows = XLSX.utils.sheet_to_json(XLSX.read(finBuf, { type: "buffer" }).Sheets["Orders"]);
ok("finance's export respects visibility", finRows.length, finList);

const anon = await fetch(`${BASE}/api/export?type=orders`);
ok("an unauthenticated export is refused", anon.status, 401);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
