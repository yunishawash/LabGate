/**
 * The bug the user found: GM was granted the sidebar link and the page, but
 * the API disagreed on its own and returned 403 — rendering as a silently
 * empty list rather than a visible error.
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

const gm = await login("gm@gwmc.com");
const admin = await login("admin@gwmc.com");
const coord = await login("sales.coord@gwmc.com");

const gmRes = await fetch(`${BASE}/api/audit-log`, { headers: { Cookie: gm } });
const gmBody = await gmRes.json();
ok("GM now gets 200", gmRes.status, 200);
ok("GM sees real entries (not an empty list hiding a 403)", gmBody.entries.length > 0, true);

ok("admin still works", (await fetch(`${BASE}/api/audit-log`, { headers: { Cookie: admin } })).status, 200);
ok("a role with no business seeing it is still refused", (await fetch(`${BASE}/api/audit-log`, { headers: { Cookie: coord } })).status, 403);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
