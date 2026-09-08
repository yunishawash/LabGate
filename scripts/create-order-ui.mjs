/**
 * Phase 7's real test, driven through the screen rather than curl: the
 * coordinator raises a two-line order from the dialog, and we then check who
 * can see it. A create that works over HTTP but not through the form is still
 * a broken feature.
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3001";
const ref = `UI-${Date.now().toString().slice(-6)}`;

const b = await chromium.launch({ executablePath: CHROME, headless: true });

async function login(email) {
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1050 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
  return p;
}

const coord = await login("sales.coord@gwmc.com");
await coord.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await coord.waitForTimeout(1500);

const before = await coord.locator("tbody tr").count();

await coord.getByRole("button", { name: /New order/i }).click();
await coord.waitForTimeout(800);

const dlg = coord.locator('[role="dialog"]');
const selects = dlg.locator("select");
// customer, then line 1: product + bag weight
await selects.nth(0).selectOption({ index: 1 });
await dlg.locator('input[placeholder*="own number"]').fill(ref);
await selects.nth(1).selectOption({ index: 1 });
await selects.nth(2).selectOption("50");
await dlg.locator('input[type="number"]').first().fill("120");

// a second line, because multi-line is the whole point
await dlg.getByRole("button", { name: /Add line/i }).click();
await coord.waitForTimeout(400);
await selects.nth(3).selectOption({ index: 2 });
await selects.nth(4).selectOption("25");
await dlg.locator('input[type="number"]').nth(1).fill("80");

const totalText = await dlg.locator("text=/bags/").first().innerText().catch(() => "");
await dlg.getByRole("button", { name: /Raise order/i }).click();

await coord.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 15000 })
  .catch(() => { throw new Error("dialog never closed — the create failed"); });
await coord.waitForTimeout(1500);

const after = await coord.locator("tbody tr").count();
const firstRow = await coord.locator("tbody tr").first().innerText();
console.log(`dialog total line : ${totalText.replace(/\s+/g, " ").trim()}`);
console.log(`rows ${before} -> ${after}`);
console.log(`new top row      : ${firstRow.replace(/\s+/g, " ").trim().slice(0, 110)}`);
// 120 * 50 + 80 * 25 = 8000 kg = 8.000 t
console.log(`8.000 t on the row: ${/8\.000/.test(firstRow) ? "YES" : "NO — server total disagrees"}`);
console.log(`reference shown   : ${firstRow.includes(ref) ? "YES" : "NO"}`);
await coord.screenshot({ path: "/tmp/ord-created.png" });

// Who can see it now? It sits at stage 2.
for (const [who, email] of [["sales manager", "sales.manager@gwmc.com"], ["finance manager", "finance@gwmc.com"]]) {
  const p = await login(email);
  const r = await p.evaluate(async (q) => {
    const res = await fetch(`/api/orders?search=${encodeURIComponent(q)}`);
    return (await res.json()).total;
  }, ref);
  console.log(`${who.padEnd(15)} sees it: ${r > 0 ? "YES" : "no"}`);
}

await b.close();
