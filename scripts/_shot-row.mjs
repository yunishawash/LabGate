import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1100 } });
await ctx.addCookies([{ name: "labgate-lang", value: "ar", domain: "localhost", path: "/" }]);
const p = await ctx.newPage();
await p.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await p.fill('input[name="email"]', "admin@gwmc.com");
await p.fill('input[name="password"]', "pass123");
await p.click('button[type="submit"]');
for (let i = 0; i < 30 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
await p.goto("http://localhost:3001/dashboard", { waitUntil: "networkidle" });
await p.waitForTimeout(3500);
const txt = (await p.locator("body").innerText()).replace(/\s+/g, " ");
console.log("orders card :", /الطلبيات حسب المدينة/.test(txt));
console.log("tonnage card:", /الكميات حسب المدينة/.test(txt));
const box = await p.evaluate(() => {
  const cards = [...document.querySelectorAll("div")].filter(
    (d) => d.querySelector(".recharts-surface") &&
      (d.textContent?.includes("الطلبيات حسب المدينة") || d.textContent?.includes("الكميات حسب المدينة")));
  const a = cards.find((c) => c.textContent?.includes("الطلبيات حسب المدينة"));
  const z = cards.find((c) => c.textContent?.includes("الكميات حسب المدينة"));
  if (!a || !z) return null;
  const ra = a.getBoundingClientRect(), rz = z.getBoundingClientRect();
  a.scrollIntoView({ block: "center" });
  return { sameRow: Math.abs(ra.top - rz.top) < 40, aTop: Math.round(ra.top), zTop: Math.round(rz.top) };
});
console.log("side by side:", JSON.stringify(box));
await p.waitForTimeout(900);
await p.screenshot({ path: process.argv[2] });
await b.close();
