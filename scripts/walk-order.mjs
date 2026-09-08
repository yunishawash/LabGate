/** Walk an order 1 -> 8 -> Posted, then reject another, then race stage 7. */
const BASE = "http://localhost:3001";
async function login(email) {
  const jar = [];
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) jar.push(c.split(";")[0]); };
  const cookie = () => jar.join("; ");
  let r = await fetch(`${BASE}/api/auth/csrf`); keep(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: "pass123" }), redirect: "manual" });
  keep(r); return cookie();
}
const api = (c, p, i = {}) => fetch(BASE + p, { ...i, headers: { cookie: c, "Content-Type": "application/json", ...(i.headers ?? {}) } });
const ok = (l, got, want) => console.log(`  ${String(got) === String(want) ? "✓" : "✗"} ${l.padEnd(56)} ${got}${String(got) === String(want) ? "" : `  (expected ${want})`}`);

const C = {};
for (const [k, e] of Object.entries({
  admin: "admin@gwmc.com", coord: "sales.coord@gwmc.com", sm: "sales.manager@gwmc.com",
  fin: "finance@gwmc.com", gm: "gm@gwmc.com", tm: "tech.manager@gwmc.com",
  lab: "lab.tech@gwmc.com", wb: "weighbridge@gwmc.com",
})) C[k] = await login(e);

const customers = await (await api(C.admin, "/api/customers")).json();
const products = await (await api(C.admin, "/api/lab/products")).json();
const RUN = Date.now().toString(36).slice(-4).toUpperCase();

const newOrder = async (ref) => (await (await api(C.coord, "/api/orders", { method: "POST", body: JSON.stringify({
  customerId: customers.customers[0]._id,
  orderDate: new Date().toISOString().slice(0, 10),
  referenceNo: `${RUN}-${ref}`,
  lines: [{ productId: products.products[0]._id, bagWeightKg: 50, bagCount: 400 }],
})})).json());

const approve = (who, id, note) => api(C[who], `/api/orders/${id}/approve`, { method: "POST", body: JSON.stringify({ note }) });
const stageOf = async (id) => (await (await api(C.admin, `/api/orders/${id}`)).json()).currentStageIndex;

console.log("── walking one order to Posted ──");
const a = await newOrder("WALK");
console.log(`  ${a.orderNumber} · ${a.totalWeightKg} kg ordered\n`);

ok("starts at stage 2", a.currentStageIndex, 2);
let r = await approve("sm", a._id, "price agreed"); ok("sales manager approves -> stage 3", (await r.json()).advancedTo, 3);
r = await approve("fin", a._id);                    ok("finance approves      -> stage 4", (await r.json()).advancedTo, 4);
r = await approve("gm", a._id);                     ok("GM approves           -> stage 5", (await r.json()).advancedTo, 5);
r = await approve("tm", a._id);                     ok("technical approves    -> stage 6", (await r.json()).advancedTo, 6);

r = await approve("fin", a._id);
ok("finance cannot approve again out of turn", r.status, 403);

// Stage 6 is data entry — the lab route arrives in phase 8, so step past it.
await api(C.admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: a._id, stage: 7 }) });

console.log("\n── stage 7: the joint gate ──");
r = await approve("gm", a._id);
let j = await r.json();
ok("GM signs, order does NOT advance", j.advancedTo, "null");
ok("and is told the other signature is missing", j.waitingForOther, true);
ok("still at stage 7", await stageOf(a._id), 7);
r = await approve("gm", a._id);
ok("GM cannot sign twice", r.status, 403);
r = await approve("tm", a._id);
ok("technical signs -> stage 8", (await r.json()).advancedTo, 8);

console.log("\n── weighing ──");
r = await api(C.fin, `/api/orders/${a._id}/weigh`, { method: "POST", body: JSON.stringify({ actualNetWeightKg: 19900 }) });
ok("finance cannot weigh", r.status, 403);
r = await api(C.wb, `/api/orders/${a._id}/weigh`, { method: "POST", body: JSON.stringify({ actualNetWeightKg: -5 }) });
ok("a negative weight is refused", r.status, 400);
r = await api(C.wb, `/api/orders/${a._id}/weigh`, { method: "POST", body: JSON.stringify({ actualNetWeightKg: 19940 }) });
const w = await r.json();
ok("weighbridge posts it", w.posted, true);
ok("ordered 20000 kg, actual 19940 -> variance", w.varianceKg, -60);
ok("as a percentage", w.variancePct, -0.3);
ok("status is Posted", w.order.status, "Posted");
r = await approve("wb", a._id);
ok("a posted order refuses further action", r.status, 409);

console.log("\n── rejection is terminal ──");
const b = await newOrder("REJ");
r = await api(C.fin, `/api/orders/${b._id}/reject`, { method: "POST", body: JSON.stringify({ reason: "x" }) });
// 404, not 403 — and that is the stronger answer. At stage 2 the finance
// manager cannot SEE this order, so the response must not distinguish it from
// an order that does not exist.
ok("finance gets the same 404 as for a nonexistent order", r.status, 404);
r = await api(C.gm, `/api/orders/${b._id}/reject`, { method: "POST", body: JSON.stringify({}) });
ok("a rejection with no reason is refused", r.status, 400);
r = await api(C.gm, `/api/orders/${b._id}/reject`, { method: "POST", body: JSON.stringify({ reason: "credit limit exceeded" }) });
const rej = await r.json();
ok("the GM may reject at any stage", rej.closed, true);
ok("status is Rejected", rej.order.status, "Rejected");
ok("the reason is kept", rej.order.rejection.reason, "credit limit exceeded");
ok("downstream steps are marked skipped, not left pending",
  rej.order.steps.filter((s) => s.status === "skipped").length > 0, true);
ok("no step is left pending on a dead order",
  rej.order.steps.some((s) => s.status === "pending"), false);
r = await approve("sm", b._id);
ok("a rejected order refuses approval", r.status, 409);
ok("the lab can no longer see it", (await api(C.lab, `/api/orders/${b._id}`)).status, 404);

console.log("\n── two managers signing stage 7 at the same instant ──");
const c = await newOrder("RACE");
await api(C.admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: c._id, stage: 7 }) });
const [g1, t1] = await Promise.all([approve("gm", c._id), approve("tm", c._id)]);
const [gj, tj] = [await g1.json(), await t1.json()];
ok("both signatures succeed", `${g1.status},${t1.status}`, "200,200");
ok("exactly one of them advanced the order", [gj.advancedTo, tj.advancedTo].filter((x) => x === 8).length, 1);
ok("the order advanced exactly once", await stageOf(c._id), 8);
const final = await (await api(C.admin, `/api/orders/${c._id}`)).json();
ok("both stage-7 slots are signed", final.steps.filter((s) => s.stageIndex === 7 && s.status === "approved").length, 2);
