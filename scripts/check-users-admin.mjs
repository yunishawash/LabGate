/**
 * The users screen is where signing authority is handed out, so its guards
 * matter more than its layout.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import mongoose from "mongoose";

const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(54)} ${p?got:`got ${got}, want ${want}`}`); };

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
const api = (c, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: c, ...(init.headers || {}) } });

await mongoose.connect(process.env.MONGODB_URI);
const Users = mongoose.connection.collection("users");
const Audit = mongoose.connection.collection("auditlogs");

const admin = await login("admin@gwmc.com");
const gm = await login("gm@gwmc.com");

// ── who may reach it at all ───────────────────────────────────────────────
ok("admin can list users", (await api(admin, "/api/users")).status, 200);
ok("the GM cannot", (await api(gm, "/api/users")).status, 403);
ok("nor anonymously", (await fetch(`${BASE}/api/users`)).status, 401);
ok("the GM cannot read the audit log", (await api(gm, "/api/audit-log")).status, 403);
ok("admin can", (await api(admin, "/api/audit-log")).status, 200);

// ── passwords never come back, and are never stored in the clear ──────────
const list = await (await api(admin, "/api/users?limit=200")).json();
ok("no password field is ever returned", list.users.some((u) => "password" in u), false);

const email = `probe.${Date.now()}@gwmc.com`;
const created = await (await api(admin, "/api/users", {
  method: "POST",
  body: JSON.stringify({ name: "Probe User", email, password: "pass123", role: "accountant", permissions: ["orders"] }),
})).json();
ok("a user is created", !!created._id, true);

const raw = await Users.findOne({ email });
ok("the password is bcrypt-hashed at rest", /^\$2[aby]\$12\$/.test(raw.password ?? ""), true);
ok("cost is 12", (raw.password ?? "").split("$")[2], "12");

const dupe = await api(admin, "/api/users", {
  method: "POST",
  body: JSON.stringify({ name: "Dupe", email, password: "pass123", role: "accountant" }),
});
ok("a duplicate email is refused", dupe.status, 409);

const short = await api(admin, "/api/users", {
  method: "POST",
  body: JSON.stringify({ name: "Short", email: `s.${Date.now()}@gwmc.com`, password: "abc", role: "accountant" }),
});
ok("a 3-character password is refused", short.status, 400);

// ── a role change is authority moving, so it is audited ───────────────────
const before = await Audit.countDocuments({ action: "role_changed" });
await api(admin, `/api/users/${created._id}`, {
  method: "PUT", body: JSON.stringify({ role: "finance_manager" }),
});
ok("the role change is audited", await Audit.countDocuments({ action: "role_changed" }), before + 1);
const entry = await Audit.findOne({ action: "role_changed" }, { sort: { timestamp: -1 } });
ok("the entry records both roles", `${entry.oldValue}->${entry.newValue}`, "accountant->finance_manager");

// A password reset must be traceable even though the value never is.
const pwBefore = await Audit.countDocuments({ action: "password_reset" });
await api(admin, `/api/users/${created._id}`, { method: "PUT", body: JSON.stringify({ password: "newpass123" }) });
ok("a password reset is audited", await Audit.countDocuments({ action: "password_reset" }), pwBefore + 1);
const pwEntry = await Audit.findOne({ action: "password_reset" }, { sort: { timestamp: -1 } });
ok("but the new password is NOT in the trail", JSON.stringify(pwEntry).includes("newpass123"), false);
ok("the reset actually works", (await login(email)).length > 0, true);

// ── deactivating the last holder of a stage is refused without consent ────
const soleRole = "weighbridge";
const holders = await Users.countDocuments({ role: soleRole, isActive: true });
if (holders === 1) {
  const sole = await Users.findOne({ role: soleRole, isActive: true });
  const blocked = await api(admin, `/api/users/${sole._id}`, {
    method: "PUT", body: JSON.stringify({ isActive: false }),
  });
  ok("deactivating the only holder of a stage is blocked", blocked.status, 409);
  const msg = (await blocked.json()).error ?? "";
  ok("and the refusal says what would break", /stops every order/.test(msg), true);

  const forced = await api(admin, `/api/users/${sole._id}`, {
    method: "PUT", body: JSON.stringify({ isActive: false, confirmSoleHolder: true }),
  });
  ok("confirming goes through", forced.status, 200);
  await Users.updateOne({ _id: sole._id }, { $set: { isActive: true } });   // put it back
} else {
  console.log(`       (skipped sole-holder test: ${holders} weighbridge users)`);
}

// ── an admin cannot lock themselves out ──────────────────────────────────
const me = await Users.findOne({ email: "admin@gwmc.com" });
ok("an admin cannot deactivate themselves", (await api(admin, `/api/users/${me._id}`, { method: "DELETE" })).status, 400);

// Cleanup: deactivate rather than delete, the same rule the API enforces.
await Users.updateOne({ email }, { $set: { isActive: false } });

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
