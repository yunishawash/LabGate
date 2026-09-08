/** node scripts/shot-tab.mjs <tabLabelEn> <out.png> [ar|en] [email] */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [tabEn, out = "/tmp/tab.png", lang = "en", email = "lab.tech@gwmc.com"] = process.argv.slice(2);
const AR = { "Products & Specs": "المنتجات والمواصفات", "Customers": "الزبائن", "Quality KPIs": "مؤشرات الجودة", "Results": "النتائج" };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
await page.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "pass123");
await page.click('button[type="submit"]');
for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(500);
if (lang === "ar") await page.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
await page.goto("http://localhost:3001/lab", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: lang === "ar" ? AR[tabEn] : tabEn, exact: true }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: out });
console.log(`saved ${out} (dir=${await page.evaluate(() => document.documentElement.dir)})`);
await browser.close();
