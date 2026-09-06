import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ executablePath: CHROME, headless: true });
for (const email of ["gm@gwmc.com","lab.tech@gwmc.com","weighbridge@gwmc.com","admin@gwmc.com"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  await p.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  await p.waitForLoadState("networkidle");
  await p.waitForSelector("nav a", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(800);
  const items = await p.$$eval("nav a", els => [...new Set(els.map(e => e.textContent.trim()))]);
  console.log(email.padEnd(24), items.join(" · "));
  await ctx.close();
}
await b.close();
