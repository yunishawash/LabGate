/**
 * Phase 11's test: every sidebar item opens a working page, for every role.
 *
 * "Working" means three things, all checked: HTTP 200, no Next.js error
 * overlay, and no "not built yet" placeholder left behind. A page that renders
 * a stub is not a working page, and it is exactly the sort of thing that
 * survives to a demo.
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3001";
const b = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(50)} ${p?got:`got ${got}, want ${want}`}`); };

const ROLES = ["admin", "gm", "sales.coord", "finance", "lab.tech", "weighbridge", "tech.manager"];

for (const who of ROLES) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', `${who}@gwmc.com`);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);

  // Only what THIS role can actually see in the nav — clicking a link they do
  // not have is a different test (the proxy's, already covered).
  const links = await p.locator("nav a, aside a").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")).filter((h) => h && h.startsWith("/"))
  );
  const unique = [...new Set(links)];

  const bad = [];
  for (const href of unique) {
    const res = await p.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    const body = await p.evaluate(() => document.body.innerText);
    const status = res?.status() ?? 0;
    const stub = /not built yet|Coming in phase|لسّه ما انبنت/i.test(body);
    const crashed = /Application error|Unhandled Runtime Error|This page could not be found/i.test(body);
    if (status !== 200 || stub || crashed) {
      bad.push(`${href}(${status}${stub ? " STUB" : ""}${crashed ? " CRASH" : ""})`);
    }
  }
  ok(`${who}: ${unique.length} nav pages open`, bad.length ? bad.join(" ") : "all", "all");
  ok(`${who}: no runtime errors`, errors.length ? errors[0] : "none", "none");
  await p.context().close();
}

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await b.close();
process.exit(failed ? 1 : 0);
