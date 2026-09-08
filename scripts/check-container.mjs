/**
 * The production image, exercised as a user would.
 *
 * Building an image proves it compiles. This proves it runs: a real login
 * against the real database, through the standalone server, as the non-root
 * user, with runtime-only secrets.
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3099";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(52)} ${p?got:`got ${got}, want ${want}`}`); };

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.fill('input[name="email"]', "gm@gwmc.com");
await p.fill('input[name="password"]', "pass123");
await p.click('button[type="submit"]');
for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
ok("login works in the production image", !p.url().includes("/login"), true);

await p.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const rows = await p.locator("tbody tr").count();
ok("orders load from the database", rows > 0, true);

await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
ok("the dashboard renders blocks", await p.locator("section").count() > 0, true);

// The self-hosted Arabic face must be inside the image, not fetched from a CDN
// the plant server cannot reach.
const font = await p.evaluate(async () => {
  const r = await fetch("/fonts/thmanyahsans-Regular.woff2");
  return `${r.status}:${(await r.arrayBuffer()).byteLength}`;
});
ok("the Arabic font ships inside the image", font, "200:77684");

ok("no runtime errors", errors.length ? errors[0] : "none", "none");
await p.screenshot({ path: "/tmp/container.png" });
console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await b.close();
process.exit(failed ? 1 : 0);
