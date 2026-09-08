import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(46)} ${p?got:`got ${got}, want ${want}`}`); };

async function login(email, lang) {
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1050 } })).newPage();
  await p.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
  if (lang === "ar") await p.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
  await p.goto("http://localhost:3001/orders", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  return p;
}

const gm = await login("gm@gwmc.com", "en");
const stops = gm.locator('button[aria-pressed]');
ok("eight stops rendered", await stops.count(), 8);

// stage 1 has no orders in the demo set; stage 3 does.
const disabled = [];
for (let i = 0; i < 8; i++) if (await stops.nth(i).isDisabled()) disabled.push(i + 1);
console.log(`       stages with no orders (disabled): ${disabled.join(", ") || "none"}`);
ok("empty stages are not clickable", disabled.length > 0, true);

const rowsBefore = await gm.locator("tbody tr").count();
const live = await stops.nth(2).isDisabled() ? 4 : 2;      // 0-indexed
await stops.nth(live).click();
await gm.waitForTimeout(1800);
const rowsAfter = await gm.locator("tbody tr").count();
ok("clicking a live stage filters the table", rowsAfter < rowsBefore, true);
ok("the clicked stop is marked pressed", await stops.nth(live).getAttribute("aria-pressed"), "true");

await stops.nth(live).click();
await gm.waitForTimeout(1800);
ok("clicking again clears the filter", await gm.locator("tbody tr").count(), rowsBefore);

// direction: the first stop in DOM order must sit on the correct side
const side = async (p) => {
  const [first, last] = await Promise.all([
    p.locator('button[aria-pressed]').first().boundingBox(),
    p.locator('button[aria-pressed]').last().boundingBox(),
  ]);
  return first.x < last.x ? "left-to-right" : "right-to-left";
};
ok("English flows left to right", await side(gm), "left-to-right");
const ar = await login("gm@gwmc.com", "ar");
ok("Arabic flows right to left", await side(ar), "right-to-left");

const fin = await login("finance@gwmc.com", "en");
ok("hidden from the finance manager", await fin.locator('button[aria-pressed]').count(), 0);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await b.close();
process.exit(failed ? 1 : 0);
