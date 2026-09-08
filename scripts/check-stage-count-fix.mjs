import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3001";
let failed = 0;
const ok = (l, got, want) => { const p = String(got)===String(want); if(!p) failed++; console.log(`${p?"  ok  ":"FAIL  "}${l.padEnd(56)} ${p?got:`got ${got}, want ${want}`}`); };

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const p = await (await b.newContext({ viewport: { width: 1600, height: 1050 } })).newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.fill('input[name="email"]', "gm@gwmc.com");
await p.fill('input[name="password"]', "pass123");
await p.click('button[type="submit"]');
for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);

await p.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// Read the finance-manager chip's own count (stage 3) before clicking.
const chip = p.locator('button[aria-pressed]').nth(2); // 0-indexed: stage 3
const chipCount = (await chip.locator("bdi").last().innerText()).trim();
console.log(`       finance-manager chip count: ${chipCount}`);

await chip.click();
await p.waitForTimeout(2000);

const shown = (await p.locator("text=Shown").locator("xpath=../..").innerText()).match(/\d+/)?.[0];
const rows = await p.locator("tbody tr").count();
ok("chip count == 'Shown' stat card", shown, chipCount);
ok("chip count == actual row count", String(rows), chipCount);

// No Rejected-status rows leaked in — scoped to <tbody> specifically, since
// "Rejected" is also legitimate text elsewhere (the status <select>, the
// "How to read" panel's own explanation of what rejection means).
const tbodyText = await p.locator("tbody").innerText();
ok("no Rejected-status rows leaked into the table", tbodyText.includes("Rejected") ? "leaked" : "clean", "clean");

// dashboard pipeline link now carries the same meaning
await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const dashRows = p.locator("section", { hasText: "السلسلة" }).first();
await p.goto(`${BASE}/orders?stage=3`, { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const rows2 = await p.locator("tbody tr").count();
ok("navigating with ?stage=3 alone also implies Pending", String(rows2), chipCount);

await p.screenshot({ path: "/tmp/stagefix.png" });
console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
await b.close();
process.exit(failed ? 1 : 0);
