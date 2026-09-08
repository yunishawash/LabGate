import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [out, lang] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await p.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await p.fill('input[name="email"]', "admin@gwmc.com");
await p.fill('input[name="password"]', "pass123");
await p.click('button[type="submit"]');
for (let i = 0; i < 30 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
if (lang === "ar") await p.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
await p.goto("http://localhost:3001/customers", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
// open the customer with the most samples
const rows = p.locator("tbody tr");
let best = 0, bestN = -1;
for (let i = 0; i < await rows.count(); i++) {
  const n = parseInt((await rows.nth(i).locator("td").nth(2).innerText()) || "0", 10);
  if (n > bestN) { bestN = n; best = i; }
}
await Promise.all([
  p.waitForURL(/\/customers\/[a-f0-9]{24}/, { timeout: 20000 }),
  rows.nth(best).click(),
]);
await p.waitForLoadState("networkidle");
// Wait for the data, not just the route: a cold dev compile leaves the page on
// its loading state well past networkidle.
await p.waitForFunction(
  () => !/Loading|جارٍ التحميل/.test(document.body.innerText),
  { timeout: 30000 }
).catch(() => {});
await p.waitForTimeout(1200);
await p.screenshot({ path: out });
console.log(`saved ${out} (dir=${await p.evaluate(() => document.documentElement.dir)}, samples=${bestN})`);
await b.close();
