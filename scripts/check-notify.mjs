/**
 * Phase 9's test, exactly as the checklist words it: approve in one browser,
 * watch the other person's bell increment WITHOUT a refresh. Anything that
 * polls the page or reloads it would pass while the SSE channel was dead.
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3001";
const ref = `NOTIF-${Date.now().toString().slice(-6)}`;
const b = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(52)} ${p?got:`got ${got}, want ${want}`}`); };

async function login(email) {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
  return p;
}
const badge = (p) => p.locator('header button[aria-label] span').first();
const badgeText = async (p) => (await badge(p).count()) ? (await badge(p).innerText()).trim() : "0";

// The finance manager sits on the orders page and never touches it again.
const fin = await login("finance@gwmc.com");
await fin.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await fin.waitForTimeout(3000);
await fin.evaluate(async () => {
  await fetch("/api/notifications", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllRead: true }) });
});
await fin.reload({ waitUntil: "networkidle" });
await fin.waitForTimeout(3000);
ok("finance starts with an empty bell", await badgeText(fin), "0");

/**
 * Stamp the tab so the final assertion can prove it was never reloaded.
 * `performance.getEntriesByType("resource")` looked like the obvious probe for
 * "is the stream open", but Chrome does not record an EventSource there — it
 * reported false while the channel was working perfectly. The honest proof that
 * the stream is live is the badge changing on a page nobody touched.
 */
await fin.evaluate(() => { window.__tabId = Math.random().toString(36); });
const tabBefore = await fin.evaluate(() => window.__tabId);

// Elsewhere: raise an order and push it to finance's stage.
const coord = await login("sales.coord@gwmc.com");
const created = await coord.evaluate(async (r) => {
  const cs = await (await fetch("/api/customers")).json();
  const ps = await (await fetch("/api/lab/products")).json();
  const res = await fetch("/api/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: cs.customers[0]._id, referenceNo: r,
      orderDate: new Date().toISOString().slice(0, 10),
      lines: [{ productId: ps.products[0]._id, bagWeightKg: 50, bagCount: 60 }],
    }),
  });
  return (await res.json())._id;
}, ref);
ok("order raised", !!created, true);

// The sales manager should have been told immediately, without acting.
const sm = await login("sales.manager@gwmc.com");
await sm.waitForTimeout(1500);
const smUnread = await sm.evaluate(async () => (await (await fetch("/api/notifications?limit=1")).json()).unread);
ok("sales manager was notified on creation", smUnread > 0, true);

// Finance's bell must still be empty — the order has not reached them.
await fin.waitForTimeout(2000);
ok("finance NOT notified before their turn", await badgeText(fin), "0");

// Now approve as the sales manager; finance's tab is untouched throughout.
await sm.evaluate(async (id) => {
  await fetch(`/api/orders/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "" }) });
}, created);

let live = "0";
for (let i = 0; i < 20; i++) {          // the client coalesces for 400ms
  await fin.waitForTimeout(500);
  live = await badgeText(fin);
  if (live !== "0") break;
}
ok("finance's bell incremented", live, "1");
ok("…on a tab that was never reloaded", await fin.evaluate(() => window.__tabId), tabBefore);

// And the notification points somewhere useful.
await fin.goto(`${BASE}/notifications`, { waitUntil: "networkidle" });
await fin.waitForTimeout(1800);
const rows = fin.locator("div.cursor-pointer").filter({ hasText: "ORD-" });
ok("it shows on the notifications page", await rows.count() > 0, true);
await rows.first().click();
await fin.waitForTimeout(2500);
ok("clicking it opens the order", fin.url().includes(`/orders/${created}`), true);
await fin.screenshot({ path: "/tmp/notif.png" });

console.log(`\n${failed ? `${failed} FAILED` : "all passed"} · ${ref}`);
await b.close();
process.exit(failed ? 1 : 0);
