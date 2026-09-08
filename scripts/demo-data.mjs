/** A believable slice of plant activity, so screens can be judged on real shapes. */
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

const C = {};
for (const [k, e] of Object.entries({
  admin: "admin@gwmc.com", coord: "sales.coord@gwmc.com", sm: "sales.manager@gwmc.com",
  fin: "finance@gwmc.com", gm: "gm@gwmc.com", tm: "tech.manager@gwmc.com",
  lab: "lab.tech@gwmc.com", wb: "weighbridge@gwmc.com",
})) C[k] = await login(e);

const { customers } = await (await api(C.admin, "/api/customers")).json();
const { products } = await (await api(C.admin, "/api/lab/products")).json();
const { parameters } = await (await api(C.admin, "/api/lab/parameters")).json();

let seed = 20260906;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const approve = (who, id) => api(C[who], `/api/orders/${id}/approve`, { method: "POST", body: JSON.stringify({}) });

// A realistic spread: most orders posted, a few mid-chain, a couple rejected.
const PLAN = [
  ...Array(6).fill("posted"),
  ...Array(2).fill("stage3"), ...Array(2).fill("stage5"),
  "stage6", "stage7", ...Array(2).fill("rejected"),
];

let made = 0;
for (const [i, outcome] of PLAN.entries()) {
  const customer = pick(customers);
  const daysAgo = Math.floor(rnd() * 40);
  const date = new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
  const bagWeightKg = pick([25, 50, 50, 30, 60]);
  const bagCount = 40 + Math.floor(rnd() * 360);

  const order = await (await api(C.coord, "/api/orders", { method: "POST", body: JSON.stringify({
    customerId: customer._id, orderDate: date,
    referenceNo: `SL-${String(1200 + i)}`,
    lines: [{ productId: pick(products)._id, bagWeightKg, bagCount }],
  })})).json();
  if (!order._id) continue;
  made++;

  if (outcome === "rejected") {
    const who = pick(["fin", "gm"]);
    if (who === "fin") await approve("sm", order._id);
    await api(C[who], `/api/orders/${order._id}/reject`, { method: "POST", body: JSON.stringify({
      reason: pick(["Credit limit exceeded", "Customer cancelled", "Grade unavailable this month"]) })});
    continue;
  }

  await approve("sm", order._id);
  if (outcome === "stage3") continue;
  await approve("fin", order._id);
  await approve("gm", order._id);
  if (outcome === "stage5") continue;
  await approve("tm", order._id);
  if (outcome === "stage6") continue;

  // Record the lab sample for this order, then step past stage 6 (the wiring
  // that links them arrives in phase 8).
  const specs = await (await api(C.lab, `/api/lab/products/${order.lines[0].productId}/specs`)).json();
  const results = specs.specs.slice(0, 7).map((s) => {
    let v;
    if (s.min != null && s.max != null) v = s.min + rnd() * (s.max - s.min);
    else if (s.max != null) v = s.max * (0.86 + rnd() * 0.14);
    else if (s.min != null) v = s.min * (1.0 + rnd() * 0.18);
    else v = 60 + rnd() * 20;
    return { parameterId: s.parameterId, value: Math.round(v * 100) / 100 };
  });
  await api(C.lab, "/api/lab/samples", { method: "POST", body: JSON.stringify({
    productId: order.lines[0].productId, customerId: customer._id,
    sampleDate: date, shift: pick(["morning", "afternoon", "night"]),
    batchId: `B-${date.slice(5).replace("-", "")}-${i}`, results,
  })});
  await api(C.admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: order._id, stage: 7 }) });
  if (outcome === "stage7") continue;

  await approve("gm", order._id);
  await approve("tm", order._id);
  const ordered = bagWeightKg * bagCount;
  await api(C.wb, `/api/orders/${order._id}/weigh`, { method: "POST", body: JSON.stringify({
    actualNetWeightKg: Math.round(ordered * (0.996 + rnd() * 0.008)) })});
}

const all = await (await api(C.admin, "/api/orders?limit=100")).json();
const byStage = {};
for (const o of all.orders) {
  const k = o.status === "Pending" ? `stage ${o.currentStageIndex}` : o.status;
  byStage[k] = (byStage[k] ?? 0) + 1;
}
console.log(`created ${made} orders`);
for (const [k, n] of Object.entries(byStage).sort()) console.log(`  ${k.padEnd(10)} ${n}`);
