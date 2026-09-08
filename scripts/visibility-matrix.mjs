/**
 * Drives the API as each of the nine roles and asserts who can see an order at
 * each stage. This is the confidentiality model tested over HTTP — the unit
 * tests prove the filter's shape, this proves the wiring.
 */
const BASE = "http://localhost:3001";
const ROLES = [
  ["admin", "admin@gwmc.com"],
  ["sales_coordinator", "sales.coord@gwmc.com"],
  ["sales_manager", "sales.manager@gwmc.com"],
  ["finance_manager", "finance@gwmc.com"],
  ["accountant", "accountant@gwmc.com"],
  ["general_manager", "gm@gwmc.com"],
  ["technical_manager", "tech.manager@gwmc.com"],
  ["lab_technician", "lab.tech@gwmc.com"],
  ["weighbridge", "weighbridge@gwmc.com"],
];

async function login(email) {
  const jar = [];
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(";")[0]);
  };
  const cookie = () => jar.join("; ");

  let r = await fetch(`${BASE}/api/auth/csrf`);
  keep(r);
  const { csrfToken } = await r.json();

  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email, password: "pass123" }),
    redirect: "manual",
  });
  keep(r);
  return cookie();
}

const api = (cookie, path, init = {}) =>
  fetch(BASE + path, { ...init, headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) } });

const cookies = {};
for (const [role, email] of ROLES) cookies[role] = await login(email);

// Create one order as the coordinator, then walk it forward by writing the
// stage index directly — the transition API arrives in phase 5.
const customers = await (await api(cookies.admin, "/api/customers")).json();
const products = await (await api(cookies.admin, "/api/lab/products")).json();
const created = await api(cookies.sales_coordinator, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: customers.customers[0]._id,
    orderDate: new Date().toISOString().slice(0, 10),
    referenceNo: "LEDGER-77",
    lines: [{ productId: products.products[0]._id, bagWeightKg: 50, bagCount: 200 }],
  }),
});
if (created.status !== 201) {
  console.error("create failed:", created.status, await created.text());
  process.exit(1);
}
const order = await created.json();
console.log(`order ${order.orderNumber} · ${order.totalBags} bags · ${order.totalWeightKg} kg · ref ${order.referenceNo}\n`);

const canSee = async (role) => (await api(cookies[role], `/api/orders/${order._id}`)).status === 200;

const header = ROLES.map(([r]) => r.replace(/_/g, " ").slice(0, 9).padStart(9)).join(" ");
console.log("stage".padEnd(7) + header);

const EXPECTED = {
  2: ["admin", "sales_coordinator", "sales_manager", "general_manager"],
  3: ["admin", "sales_coordinator", "sales_manager", "finance_manager", "accountant", "general_manager"],
  4: ["admin", "sales_coordinator", "sales_manager", "finance_manager", "accountant", "general_manager"],
  5: ["admin", "sales_coordinator", "sales_manager", "finance_manager", "accountant", "general_manager", "technical_manager"],
  6: ["admin", "sales_coordinator", "sales_manager", "finance_manager", "accountant", "general_manager", "technical_manager", "lab_technician"],
  7: ["admin", "sales_coordinator", "sales_manager", "finance_manager", "accountant", "general_manager", "technical_manager", "lab_technician"],
  8: ROLES.map(([r]) => r),
};

let failures = 0;
for (const stage of [2, 3, 4, 5, 6, 7, 8]) {
  await setStage(order._id, stage);

  const row = [];
  for (const [role] of ROLES) {
    const seen = await canSee(role);
    const should = EXPECTED[stage].includes(role);
    if (seen !== should) failures++;
    row.push((seen ? (should ? "  ✓" : " ✗!!") : should ? " ✗!!" : "  ·").padStart(9));
  }
  console.log(String(stage).padEnd(7) + row.join(" "));
}

console.log(`\n${failures === 0 ? "PASS — the matrix matches" : `FAIL — ${failures} cell(s) wrong`}`);
process.exit(failures === 0 ? 0 : 1);

// Move the order to a stage by talking to Mongo through a tiny admin helper.
async function setStage(id, stage) {
  const res = await api(cookies.admin, `/api/dev/set-stage`, {
    method: "POST",
    body: JSON.stringify({ id, stage }),
  });
  if (!res.ok) { console.error("set-stage failed", res.status, await res.text()); process.exit(1); }
}
