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
  const all = [...res.headers.getSetCookie(), ...r.headers.getSetCookie()].map((c) => c.split(";")[0]);
  return [...new Map(all.map((c) => [c.split("=")[0], c])).values()].join("; ");
}
const api = (c, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: c, ...(init.headers || {}) } });

const sm = await login("sales.manager@gwmc.com");
const coord = await login("sales.coord@gwmc.com");
const tag = Date.now().toString().slice(-6);

// create
const made = await (await api(sm, "/api/customers", {
  method: "POST",
  body: JSON.stringify({ name: `Test Bakery ${tag}`, nameAr: `مخبز تجريبي ${tag}`, code: `T${tag}`, phone: "0599000000" }),
})).json();
ok("a customer is created", !!made._id, true);

// the coordinator may read but not change the register
ok("the coordinator can list", (await api(coord, "/api/customers")).status, 200);
ok("but cannot create", (await api(coord, "/api/customers", {
  method: "POST", body: JSON.stringify({ name: `Nope ${tag}` }),
})).status, 403);
ok("nor archive", (await api(coord, `/api/customers/${made._id}`, { method: "DELETE" })).status, 403);

// edit
const edited = await (await api(sm, `/api/customers/${made._id}`, {
  method: "PUT",
  body: JSON.stringify({ nameAr: `مخبز معدّل ${tag}`, phone: "0599111111", contactName: "Sami" }),
})).json();
ok("an edit saves", edited.nameAr, `مخبز معدّل ${tag}`);
ok("and keeps other fields", edited.contactName, "Sami");

// the dedupe rule still applies on edit
const other = await (await api(sm, "/api/customers", {
  method: "POST", body: JSON.stringify({ name: `Second Bakery ${tag}` }),
})).json();
ok("renaming onto an existing name is refused", (await api(sm, `/api/customers/${other._id}`, {
  method: "PUT", body: JSON.stringify({ name: `  test   bakery ${tag}  ` }),
})).status, 409);

// archive
ok("archiving works", (await api(sm, `/api/customers/${made._id}`, { method: "DELETE" })).status, 200);
const active = await (await api(sm, "/api/customers")).json();
ok("archived rows leave the default list", active.customers.some((c) => c._id === made._id), false);
const all = await (await api(sm, "/api/customers?includeInactive=true")).json();
ok("but appear when asked for", all.customers.some((c) => c._id === made._id), true);

// an archived customer must not be selectable on a new order
const orderTry = await api(coord, "/api/orders", {
  method: "POST",
  body: JSON.stringify({
    customerId: made._id, orderDate: new Date().toISOString().slice(0, 10),
    lines: [{ productId: (await (await api(coord, "/api/lab/products")).json()).products[0]._id, bagWeightKg: 50, bagCount: 1 }],
  }),
});
ok("an archived customer cannot take a new order", orderTry.status, 400);

// restore, including the name-collision case the partial index allows
const reuse = await (await api(sm, "/api/customers", {
  method: "POST", body: JSON.stringify({ name: `Test Bakery ${tag}` }),
})).json();
ok("the freed name can be reused while archived", !!reuse._id, true);
const blocked = await api(sm, `/api/customers/${made._id}`, {
  method: "PUT", body: JSON.stringify({ isActive: true }),
});
ok("restoring onto a taken name is refused", blocked.status, 409);
ok("and the refusal explains why", /already active under that name/.test((await blocked.json()).error ?? ""), true);

await api(sm, `/api/customers/${reuse._id}`, { method: "DELETE" });
const restored = await api(sm, `/api/customers/${made._id}`, {
  method: "PUT", body: JSON.stringify({ isActive: true }),
});
ok("restoring works once the name is free", restored.status, 200);
ok("and it is back in the default list",
  (await (await api(sm, "/api/customers")).json()).customers.some((c) => c._id === made._id), true);

// tidy up
for (const id of [made._id, other._id]) await api(sm, `/api/customers/${id}`, { method: "DELETE" });

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
