/** Screenshot a dialog: log in, open /lab, click "New sample", fill a couple of
 *  readings so the live verdict shows, then capture.
 *    node scripts/shot-dialog.mjs <out.png> [ar|en] */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [out = "/tmp/dlg.png", lang = "en"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', "lab.tech@gwmc.com");
await page.fill('input[name="password"]', "pass123");
await page.click('button[type="submit"]');
for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(500);

if (lang === "ar") {
  await page.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
}
await page.goto("http://localhost:3001/lab", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

await page.getByRole("button", { name: lang === "ar" ? /عيّنة جديدة/ : /New sample/ }).click();
await page.waitForTimeout(600);

// Pick a product so the spec sheet loads.
const select = page.locator('[role="dialog"] select').first();
await select.selectOption({ index: 1 });
await page.waitForTimeout(1200);

// Type readings: one comfortably in spec, one out of range.
const nums = page.locator('[role="dialog"] input[type="number"]');
const n = await nums.count();
for (let i = 0; i < Math.min(n, 6); i++) {
  const box = nums.nth(i);
  const spec = await box.evaluate((el) => el.closest("div.flex")?.querySelector("bdi")?.textContent ?? "");
  const m = spec.match(/([\d.]+)\s*[–-]\s*([\d.]+)/) || spec.match(/[≤≥]\s*([\d.]+)/);
  let v = 10;
  if (m && m[2]) v = (parseFloat(m[1]) + parseFloat(m[2])) / 2;
  else if (m) v = parseFloat(m[1]) * 0.9;
  if (i === 2) v = v * 3;                 // one deliberately out of range
  await box.fill(String(Math.round(v * 100) / 100));
}
await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log(`saved ${out} (dir=${await page.evaluate(() => document.documentElement.dir)})`);
await browser.close();
