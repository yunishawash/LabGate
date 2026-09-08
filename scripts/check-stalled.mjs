/**
 * The zero-recipient rule (SPEC §14.7). Stage 5 has no deputy by the client's
 * own decision, so deactivating the technical manager leaves an order that
 * nobody in the world can move. Silence there would be the worst outcome: the
 * order simply ages while everyone assumes somebody else has it.
 */
import mongoose from "mongoose";
// `dotenv/config` only reads `.env`; Next puts local settings in `.env.local`.
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(52)} ${p?got:`got ${got}, want ${want}`}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await r.json();
  const jar = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar },
    body: new URLSearchParams({ email, password: "pass123", csrfToken }),
  });
  const all = [...res.headers.getSetCookie(), ...r.headers.getSetCookie()]
    .map((c) => c.split(";")[0]);
  return [...new Map(all.map((c) => [c.split("=")[0], c])).values()].join("; ");
}
const api = (cookie, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers || {}) } });

await mongoose.connect(process.env.MONGODB_URI);
const Users = mongoose.connection.collection("users");
const Notes = mongoose.connection.collection("notifications");

const ref = `STALL-${Date.now().toString().slice(-6)}`;
const [coord, sm, fin, gm, admin] = await Promise.all(
  ["sales.coord", "sales.manager", "finance", "gm", "admin"].map((u) => login(`${u}@gwmc.com`))
);

// Walk a fresh order to stage 5, where no deputy exists.
const cs = await (await api(coord, "/api/customers")).json();
const ps = await (await api(coord, "/api/lab/products")).json();
const order = await (await api(coord, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: cs.customers[0]._id, referenceNo: ref,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ productId: ps.products[0]._id, bagWeightKg: 25, bagCount: 40 }],
  }),
})).json();
for (const who of [sm, fin, gm]) {
  await api(who, `/api/orders/${order._id}/approve`, { method: "POST", body: JSON.stringify({}) });
}
const at5 = await (await api(gm, `/api/orders/${order._id}`)).json();
ok("order parked at stage 5", at5.currentStageIndex, 5);

// Now remove the only person who can move it, and push another order in.
await Users.updateOne({ email: "tech.manager@gwmc.com" }, { $set: { isActive: false } });
const before = await Notes.countDocuments({ type: "order_stalled" });

const order2 = await (await api(coord, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: cs.customers[0]._id, referenceNo: `${ref}-B`,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ productId: ps.products[0]._id, bagWeightKg: 25, bagCount: 20 }],
  }),
})).json();
for (const who of [sm, fin, gm]) {
  await api(who, `/api/orders/${order2._id}/approve`, { method: "POST", body: JSON.stringify({}) });
}
await new Promise((r) => setTimeout(r, 2500));   // fan-out is fire-and-forget

const after = await Notes.countDocuments({ type: "order_stalled" });
ok("admins were told the order is stalled", after > before, true);

const note = await Notes.findOne({ type: "order_stalled", salesOrderId: new mongoose.Types.ObjectId(String(order2._id)) });
ok("the alert names the missing role", /Technical Manager/.test(note?.message ?? ""), true);
ok("and says which order and stage", /stage 5/.test(note?.message ?? ""), true);
ok("Arabic copy is present too", (note?.messageAr ?? "").includes("المدير التقني"), true);
console.log(`       "${note?.message}"`);

// Restore, and confirm the desk being staffed again notifies normally.
await Users.updateOne({ email: "tech.manager@gwmc.com" }, { $set: { isActive: true } });
const tm = await login("tech.manager@gwmc.com");
const unreadBefore = (await (await api(tm, "/api/notifications?limit=1")).json()).unread;
const order3 = await (await api(coord, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: cs.customers[0]._id, referenceNo: `${ref}-C`,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ productId: ps.products[0]._id, bagWeightKg: 25, bagCount: 20 }],
  }),
})).json();
for (const who of [sm, fin, gm]) {
  await api(who, `/api/orders/${order3._id}/approve`, { method: "POST", body: JSON.stringify({}) });
}
await new Promise((r) => setTimeout(r, 2500));
const unreadAfter = (await (await api(tm, "/api/notifications?limit=1")).json()).unread;
ok("a staffed desk is notified normally", unreadAfter > unreadBefore, true);

/**
 * Nobody hears about their own action. The GM SHOULD have one notification for
 * this order — stage 4 was his turn — but none for stage 5, which he created by
 * approving. (First pass asserted zero and failed; the code was right and the
 * assertion was measuring the wrong thing.)
 */
const gmId = (await Users.findOne({ email: "gm@gwmc.com" }))._id;
const gmNotes = await Notes.find({
  salesOrderId: new mongoose.Types.ObjectId(String(order3._id)),
  userId: gmId, type: "order_pending",
}).toArray();
ok("the GM was told when it was his turn", gmNotes.length, 1);
ok("but not about the stage he just passed", gmNotes.some((n) => /Technical Manager/.test(n.message)), false);

/**
 * The client accepted that one person may hold two consecutive stages: the
 * sales manager may raise an order and then owns stage 2 of it. He must not be
 * notified to approve his own creation — the chain allows it, the bell should
 * not nag about it.
 */
const smId = (await Users.findOne({ email: "sales.manager@gwmc.com" }))._id;
const own = await (await api(sm, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: cs.customers[0]._id, referenceNo: `${ref}-D`,
    orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ productId: ps.products[0]._id, bagWeightKg: 25, bagCount: 8 }],
  }),
})).json();
await new Promise((r) => setTimeout(r, 2000));
ok("raising your own order does not notify you", await Notes.countDocuments({
  salesOrderId: new mongoose.Types.ObjectId(String(own._id)), userId: smId,
}), 0);

// Admins see only their own notifications, never everyone's.
const adminList = await (await api(admin, "/api/notifications?limit=100")).json();
const adminId = String((await Users.findOne({ email: "admin@gwmc.com" }))._id);
ok("admin's list is only their own", adminList.notifications.every((n) => String(n.userId) === adminId), true);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
