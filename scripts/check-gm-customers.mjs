/**
 * The permission just widened at the client's request (2026-09-07):
 * general_manager joins sales_manager/admin in managing the customer register.
 */
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

const gm = await login("gm@gwmc.com");
const coord = await login("sales.coord@gwmc.com");
const tag = Date.now().toString().slice(-6);

const created = await (await api(gm, "/api/customers", {
  method: "POST", body: JSON.stringify({ name: `GM Test ${tag}`, nameAr: `اختبار المدير ${tag}` }),
})).json();
ok("GM creates a customer", !!created._id, true);

const edited = await (await api(gm, `/api/customers/${created._id}`, {
  method: "PUT", body: JSON.stringify({ contactName: "Test Contact" }),
})).json();
ok("GM edits it", edited.contactName, "Test Contact");

ok("GM archives it", (await api(gm, `/api/customers/${created._id}`, { method: "DELETE" })).status, 200);
ok("GM restores it", (await api(gm, `/api/customers/${created._id}`, {
  method: "PUT", body: JSON.stringify({ isActive: true }),
})).status, 200);

// The coordinator must still be excluded — this was never meant to open wide.
ok("coordinator still cannot create", (await api(coord, "/api/customers", {
  method: "POST", body: JSON.stringify({ name: `Nope ${tag}` }),
})).status, 403);

// cleanup
await api(gm, `/api/customers/${created._id}`, { method: "DELETE" });

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
