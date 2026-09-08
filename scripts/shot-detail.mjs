import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [email, orderRef, out, lang = "en", tab = ""] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await (await b.newContext({ viewport: { width: 1600, height: 1150 } })).newPage();
await p.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await p.fill('input[name="email"]', email);
await p.fill('input[name="password"]', "pass123");
await p.click('button[type="submit"]');
for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
if (lang === "ar") await p.evaluate(() => localStorage.setItem("labgate-lang", "ar"));

// Resolve the order by its number through the API, so the shot names its subject.
await p.goto("http://localhost:3001/orders", { waitUntil: "networkidle" });
const id = await p.evaluate(async (q) => {
  const r = await fetch(`/api/orders?search=${encodeURIComponent(q)}`);
  return (await r.json()).orders?.[0]?._id ?? null;
}, orderRef);
if (!id) { console.log(`NOT VISIBLE to ${email}: ${orderRef}`); await b.close(); process.exit(0); }

await p.goto(`http://localhost:3001/orders/${id}`, { waitUntil: "networkidle" });
await p.waitForTimeout(1800);
if (tab) { await p.getByRole("button", { name: new RegExp(tab, "i") }).click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: out, fullPage: true });
console.log(`saved ${out} (${email}, ${lang}${tab ? ", tab=" + tab : ""})`);
await b.close();
