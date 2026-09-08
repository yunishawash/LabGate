/**
 * "As a lab technician, why would I see orders sitting with the sales
 * manager / finance manager / GM?" — checking that the list AND every stat
 * card (Waiting on me / Shown / Posted / Rejected) are scoped by the SAME
 * visibility rule, not just the table.
 */
const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(58)} ${p?got:`got ${got}, want ${want}`}`); };

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
const api = (c, path) => fetch(`${BASE}${path}`, { headers: { Cookie: c } }).then((r) => r.json());

const labc = await login("lab.tech@gwmc.com");
const admin = await login("admin@gwmc.com");

// ── the LIST, unfiltered ────────────────────────────────────────────────
const all = await api(labc, "/api/orders?limit=1000");
const early = all.orders.filter((o) => o.status === "Pending" && o.currentStageIndex < 6);
ok("no order sitting BEFORE the lab (stage 2-5) is visible", early.length, 0);
console.log(`       lab tech sees ${all.total} orders total`);

// ── every stat card the Orders Overview page shows ─────────────────────
const shown = await api(labc, "/api/orders?limit=1");
const posted = await api(labc, "/api/orders?status=Posted&limit=1");
const rejected = await api(labc, "/api/orders?status=Rejected&limit=1");
const waiting = await api(labc, "/api/orders?mine=true&limit=1");
const adminShown = await api(admin, "/api/orders?limit=1");

console.log(`       Shown=${shown.total}  Posted=${posted.total}  Rejected=${rejected.total}  Waiting on me=${waiting.total}`);
console.log(`       (for comparison, admin sees ${adminShown.total} total)`);

ok("Shown + nothing early = consistent with the list above", shown.total, all.total);
ok("lab tech sees strictly fewer orders than the admin", shown.total < adminShown.total, true);

// Every rejected order lab tech can see must have died AT or AFTER the lab —
// a rejection at finance (stage 3) happened before the lab ever touched it.
const rejList = await api(labc, "/api/orders?status=Rejected&limit=1000");
const rejectedTooEarly = rejList.orders.filter((o) => (o.rejection?.stageIndex ?? 0) < 6);
ok("no visible rejection died before reaching the lab", rejectedTooEarly.length, 0);

// Sanity: the admin DOES see early-stage orders, proving the difference is
// the lab tech's own scope, not something globally broken.
const adminEarly = (await api(admin, "/api/orders?limit=1000")).orders
  .filter((o) => o.status === "Pending" && o.currentStageIndex < 6);
ok("...while the admin correctly DOES see those same early orders", adminEarly.length > 0, true);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
