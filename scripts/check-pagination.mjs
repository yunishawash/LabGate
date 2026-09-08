import { config } from "dotenv";
config({ path: ".env.local" });
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

const admin = await login("admin@gwmc.com");
const gm = await login("gm@gwmc.com");

// ── customers ────────────────────────────────────────────────────────────
const custP1 = await api(admin, "/api/customers?page=1&limit=5&withStats=true");
const custP2 = await api(admin, "/api/customers?page=2&limit=5&withStats=true");
ok("customers: page 1 has 5 rows", custP1.customers.length, 5);
ok("customers: page 1 and 2 don't overlap", custP1.customers.some((c) => custP2.customers.some((d) => d._id === c._id)), false);
const custAll = await api(admin, "/api/customers?limit=1000");
ok("customers: high-limit picker still gets everyone", custAll.customers.length, custP1.total);

// ── users ────────────────────────────────────────────────────────────────
const usersP1 = await api(admin, "/api/users?page=1&limit=3");
ok("users: page 1 respects limit", usersP1.users.length, 3);
ok("users: total is the real count, not the page size", usersP1.total >= 9, true);
const activeUsers = await api(admin, "/api/users?active=true&limit=1000");
ok("users: active=true filter works for the delegation picker", activeUsers.users.every((u) => u.isActive), true);

// ── the approvals/sign-off split, now server-side ──────────────────────────
const approvalsP1 = await api(gm, "/api/orders?status=Pending&mine=true&excludeStage=7&sortField=currentStageEnteredAt&sortOrder=asc&page=1&limit=5");
ok("approvals: no stage-7 rows leaked in", approvalsP1.orders.every((o) => o.currentStageIndex !== 7), true);
ok("approvals: sorted oldest stage-entry first", 
  approvalsP1.orders.every((o, i, arr) => i === 0 || new Date(arr[i-1].currentStageEnteredAt) <= new Date(o.currentStageEnteredAt)),
  true);

const signOff = await api(gm, "/api/orders?status=Pending&stage=7&limit=5");
ok("sign-off: only stage-7 rows", signOff.orders.every((o) => o.currentStageIndex === 7), true);

const rejP1 = await api(gm, "/api/orders?status=Rejected&page=1&limit=5");
const rejP2 = await api(gm, "/api/orders?status=Rejected&page=2&limit=5");
ok("rejections: real total (not capped at old limit=100)", rejP1.total, 69);
ok("rejections: page 1 and 2 don't overlap", rejP1.orders.some((o) => rejP2.orders.some((p) => p._id === o._id)), false);

// ── excludeStage validation ────────────────────────────────────────────────
ok("excludeStage rejects a bad value", (await fetch(`${BASE}/api/orders?excludeStage=99`, { headers: { Cookie: gm } })).status, 400);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
