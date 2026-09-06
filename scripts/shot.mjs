/**
 * Screenshot driver for visual verification during the build.
 * Uses the system Chrome via playwright-core — no browser download.
 *
 *   node scripts/shot.mjs <email> <password> <path> <out.png> [ar|en]
 */
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [email, password, path = "/dashboard", out = "/tmp/shot.png", lang = "en"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);
if (page.url().endsWith("/login")) {
  throw new Error("still on /login — sign-in failed");
}

if (lang === "ar") {
  await page.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
  await page.reload({ waitUntil: "networkidle" });
}

await page.goto("http://localhost:3001" + path, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: false });

const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
console.log(`saved ${out}  (dir=${dir})`);
await browser.close();
