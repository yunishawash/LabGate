/** Absence opens the deputy; delegation opens a named stand-in. Both must also
 *  CLOSE again — an authority that never revokes is worse than none. */
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
const line = (label, got, want) =>
  console.log(`  ${String(got) === String(want) ? "✓" : "✗"} ${label.padEnd(58)} ${got}${String(got) === String(want) ? "" : `  (expected ${want})`}`);

const admin = await login("admin@gwmc.com");
const coord = await login("sales.coord@gwmc.com");
const acct  = await login("accountant@gwmc.com");
const fin   = await login("finance@gwmc.com");
const wb    = await login("weighbridge@gwmc.com");

const users = {};
for (const [k, email] of Object.entries({
  finance: "finance@gwmc.com", accountant: "accountant@gwmc.com",
  technical: "tech.manager@gwmc.com", weighbridge: "weighbridge@gwmc.com",
})) users[k] = (await (await api(admin, "/api/me", { headers: { cookie: await login(email) } })).json());

// An order sitting at stage 3, waiting on finance.
const customers = await (await api(admin, "/api/customers")).json();
const products = await (await api(admin, "/api/lab/products")).json();
const made = await (await api(coord, "/api/orders", { method: "POST", body: JSON.stringify({
  customerId: customers.customers[0]._id,
  orderDate: new Date().toISOString().slice(0, 10),
  referenceNo: `ABS-${Date.now().toString(36).slice(-4)}`,
  lines: [{ productId: products.products[0]._id, bagWeightKg: 50, bagCount: 20 }],
})})).json();
await api(admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: made._id, stage: 3 }) });
console.log(`order ${made.orderNumber} parked at stage 3 (finance)\n`);

const perms = async (cookie) => {
  const r = await api(cookie, `/api/orders/${made._id}`);
  if (r.status !== 200) return { visible: false };
  const o = await r.json();
  return { visible: true, ...o.permissions };
};

const setAbsent = (id, isAbsent, absentTo) =>
  api(admin, `/api/users/${id}/absence`, { method: "PUT", body: JSON.stringify({ isAbsent, absentTo }) });

console.log("while the finance manager is present");
line("finance manager can approve", (await perms(fin)).canApprove, true);
line("accountant can SEE it (he deputises for stage 3)", (await perms(acct)).visible, true);
line("but cannot approve — a deputy is not a second approver", (await perms(acct)).canApprove, false);

console.log("\nfinance manager marked away");
const away = await (await setAbsent(users.finance.id, true)).json();
line("the response names the stage this hands over", away.consequences[0].stageKey, "finance_manager_approval");
line("and names the deputy who gains it", away.consequences[0].deputyRole, "accountant");
line("accountant can now approve", (await perms(acct)).canApprove, true);
line("and is told he is standing in", (await perms(acct)).actingAs?.kind, "deputy");
line("on whose behalf", (await perms(acct)).actingAs?.forRole, "finance_manager");
line("the finance manager himself still can — absence is not a lockout", (await perms(fin)).canApprove, true);

console.log("\nfinance manager back");
await setAbsent(users.finance.id, false);
line("accountant loses it again", (await perms(acct)).canApprove, false);

console.log("\na stage with no deputy stalls instead");
const tmAway = await (await setAbsent(users.technical.id, true)).json();
line("marking the technical manager away reports a stall", tmAway.consequences.some((c) => c.stalls), true);
line("and offers no deputy for it", tmAway.consequences[0].deputyRole, "null");
await api(admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: made._id, stage: 5 }) });
line("the order at stage 5 reports itself stalled", (await perms(admin)).stalled?.role, "technical_manager");
await setAbsent(users.technical.id, false);

console.log("\nnamed delegation");
await api(admin, "/api/dev/set-stage", { method: "POST", body: JSON.stringify({ id: made._id, stage: 3 }) });
let r = await api(fin, "/api/delegations", { method: "POST", body: JSON.stringify({
  role: "finance_manager", toUserId: users.weighbridge.id,
  to: new Date(Date.now() + 7 * 864e5).toISOString(), reason: "annual leave",
})});
line("the finance manager may hand over his own role", r.status, 201);
const delegation = await r.json();
line("the delegate can now approve stage 3", (await perms(wb)).canApprove, true);
line("and is told it is a delegation, not a deputy", (await perms(wb)).actingAs?.kind, "delegate");
line("he can also SEE an order his own role never reaches", (await perms(wb)).visible, true);

r = await api(fin, "/api/delegations", { method: "POST", body: JSON.stringify({
  role: "finance_manager", toUserId: users.accountant.id,
  to: new Date(Date.now() + 3 * 864e5).toISOString() })});
line("a second, overlapping delegation is refused", r.status, 409);

r = await api(await login("sales.coord@gwmc.com"), "/api/delegations", { method: "POST", body: JSON.stringify({
  role: "general_manager", toUserId: users.weighbridge.id,
  to: new Date(Date.now() + 864e5).toISOString() })});
line("you cannot hand over a role you do not hold", r.status, 403);

r = await api(fin, "/api/delegations", { method: "POST", body: JSON.stringify({
  role: "finance_manager", toUserId: users.accountant.id })});
line("a delegation with no end date is refused", r.status, 400);

await api(fin, `/api/delegations/${delegation._id}`, { method: "DELETE" });
const afterRevoke = await perms(wb);
// Stronger than "cannot approve": revoking the delegation takes his VISIBILITY
// too. The weighbridge's own floor is stage 8, so a stage-3 order goes back to
// being something he is not allowed to know exists.
line("revoked, he cannot even see the order any more", afterRevoke.visible, false);
line("and certainly cannot approve", afterRevoke.canApprove ?? false, false);

console.log("\naudit trail");
const trail = await (await api(admin, "/api/dev/audit?limit=10")).json();
const actions = trail.entries.map((e) => e.action);
line("marking someone away was recorded", actions.includes("marked_away"), true);
line("bringing them back was recorded", actions.includes("marked_back"), true);
line("creating a delegation was recorded", actions.includes("delegation_created"), true);
line("revoking it was recorded", actions.includes("delegation_revoked"), true);
const created = trail.entries.find((e) => e.action === "delegation_created");
console.log(`  latest: "${created?.entityLabel}" by ${created?.performedByName}`);
