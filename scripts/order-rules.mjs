/** Edit lock, search, and the "mine" queue — the rules the API is meant to enforce. */
const BASE = "http://localhost:3001";
async function login(email) {
  const jar = [];
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) jar.push(c.split(";")[0]); };
  const cookie = () => jar.join("; ");
  let r = await fetch(`${BASE}/api/auth/csrf`); keep(r);
  const { csrfToken } = await r.json();
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: "pass123" }), redirect: "manual",
  }); keep(r);
  return cookie();
}
const api = (c, p, i = {}) => fetch(BASE + p, { ...i, headers: { cookie: c, "Content-Type": "application/json", ...(i.headers ?? {}) } });

// Every run uses its own reference, so re-running the script does not make an
// earlier run's orders look like duplicates.
const RUN = `R${Date.now().toString(36).toUpperCase().slice(-5)}`;

const coord = await login("sales.coord@gwmc.com");
const sm = await login("sales.manager@gwmc.com");
const admin = await login("admin@gwmc.com");

const customers = await (await api(admin, "/api/customers")).json();
const products = await (await api(admin, "/api/lab/products")).json();

const make = async (cookie, ref) => {
  const r = await api(cookie, "/api/orders", { method: "POST", body: JSON.stringify({
    customerId: customers.customers[0]._id,
    orderDate: new Date().toISOString().slice(0, 10),
    referenceNo: ref,
    lines: [{ productId: products.products[0]._id, bagWeightKg: 25, bagCount: 40 },
            { productId: products.products[1]._id, bagWeightKg: 50, bagCount: 10 }],
  })});
  return { status: r.status, body: await r.json() };
};

const line = (label, got, want) =>
  console.log(`  ${String(got) === String(want) ? "✓" : "✗"} ${label.padEnd(52)} ${got}${String(got) === String(want) ? "" : `  (expected ${want})`}`);

console.log("server-side totals");
const a = await make(coord, `${RUN}-A`);
line("2 lines: 25kg×40 + 50kg×10 -> totalBags", a.body.totalBags, 50);
line("                            -> totalWeightKg", a.body.totalWeightKg, 1500);
line("stage after creation is 2 (stage 1 auto-completed)", a.body.currentStageIndex, 2);
line("steps array has all nine slots", a.body.steps.length, 9);

console.log("\nvalidation");
const bad = async (payload, label, want) => {
  const r = await api(coord, "/api/orders", { method: "POST", body: JSON.stringify(payload) });
  line(label, r.status, want);
};
const baseOrder = { customerId: customers.customers[0]._id, orderDate: "2026-09-06" };
await bad({ ...baseOrder, lines: [{ productId: products.products[0]._id, bagWeightKg: 33, bagCount: 5 }] }, "bag weight 33kg is refused", 400);
await bad({ ...baseOrder, lines: [{ productId: products.products[0]._id, bagWeightKg: 50, bagCount: 0 }] }, "bag count 0 is refused", 400);
await bad({ ...baseOrder, lines: [] }, "an order with no lines is refused", 400);
await bad({ ...baseOrder, lines: [{ productId: "nope", bagWeightKg: 50, bagCount: 1 }] }, "an unknown product is refused", 400);

console.log("\nedit lock");
let r = await api(coord, `/api/orders/${a.body._id}`, { method: "PUT", body: JSON.stringify({ notes: "still mine" }) });
line("creator may edit while nobody has approved", r.status, 200);

r = await api(sm, `/api/orders/${a.body._id}`, { method: "PUT", body: JSON.stringify({ notes: "not mine" }) });
line("another user may not edit it", r.status, 409);

await api(admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: a.body._id, stage: 3 }) });
r = await api(coord, `/api/orders/${a.body._id}`, { method: "PUT", body: JSON.stringify({ notes: "too late" }) });
line("nobody may edit once finance has it", r.status, 409);

console.log("\nsearch and queue");
r = await api(admin, `/api/orders?search=${RUN}-A`);
line("search finds an order by the office's own reference", (await r.json()).total, 1);

// Assert against a KNOWN order rather than ambient state — an earlier test in
// this file already moved one order to stage 3, and the visibility run left
// another at stage 8.
const fresh = await make(coord, `${RUN}-QUEUE`);

const inQueue = async (email) => {
  const res = await api(await login(email), "/api/orders?mine=true&limit=200");
  const { orders } = await res.json();
  return orders.some((o) => o._id === fresh.body._id);
};

line("a new order lands in the sales manager's queue", await inQueue("sales.manager@gwmc.com"), true);
line("it is NOT in the finance manager's queue yet", await inQueue("finance@gwmc.com"), false);
line("nor the weighbridge's", await inQueue("weighbridge@gwmc.com"), false);

await api(admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: fresh.body._id, stage: 3 }) });
line("moved to stage 3, it leaves the sales manager's queue", await inQueue("sales.manager@gwmc.com"), false);
line("and appears in the finance manager's", await inQueue("finance@gwmc.com"), true);

console.log("\npermissions block");
r = await api(sm, `/api/orders/${a.body._id}`);
const seen = await r.json();
line("sales manager cannot approve an order finance now holds", seen.permissions.canApprove, false);
r = await api(await login("finance@gwmc.com"), `/api/orders/${a.body._id}`);
line("finance manager can", (await r.json()).permissions.canApprove, true);
