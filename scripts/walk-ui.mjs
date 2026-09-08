/**
 * Phase 8's test: click one order from stage 1 to Posted, in the browser, as
 * each role in turn. Everything here goes through the rendered page — if a
 * button is missing, mislabelled, or wired to the wrong endpoint, this fails
 * where a curl walk would still pass.
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3001";
const lang = process.argv[2] ?? "en";
const AR = lang === "ar";
const ref = `WALK-${Date.now().toString().slice(-6)}`;

const b = await chromium.launch({ executablePath: CHROME, headless: true });
const pages = new Map();
let failed = 0;

const ok = (label, got, want) => {
  const pass = String(got) === String(want);
  if (!pass) failed++;
  console.log(`${pass ? "  ok  " : "FAIL  "}${label.padEnd(52)} ${pass ? got : `got ${got}, want ${want}`}`);
};

async function page(email) {
  if (pages.has(email)) return pages.get(email);
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill('input[name="email"]', email);
  await p.fill('input[name="password"]', "pass123");
  await p.click('button[type="submit"]');
  for (let i = 0; i < 40 && p.url().includes("/login"); i++) await p.waitForTimeout(500);
  if (AR) await p.evaluate(() => localStorage.setItem("labgate-lang", "ar"));
  pages.set(email, p);
  return p;
}

const btn = (p, en, ar) => p.getByRole("button", { name: new RegExp(AR ? ar : en) });

/**
 * Click, and wait for the request it is supposed to fire.
 *
 * A fixed sleep after the click is a lie: Playwright will happily click a
 * button React has rendered but not yet attached a handler to, and the test
 * then reports a failure that only exists in the test. Waiting on the response
 * makes the assertion about the app rather than about the timing.
 */
async function clickAndWait(p, locator, urlPart) {
  const wait = p.waitForResponse(
    (r) => r.url().includes(urlPart) && r.request().method() === "POST",
    { timeout: 20000 }
  );
  for (let i = 0; i < 10; i++) {
    await locator.click();
    const res = await wait.catch(() => null);
    if (res) return res.status();
    await p.waitForTimeout(600);      // not hydrated yet — try again
  }
  return "no request fired";
}

async function openOrder(email, id) {
  const p = await page(email);
  await p.goto(`${BASE}/orders/${id}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  return p;
}

async function stageOf(email, id) {
  const p = await page(email);
  return p.evaluate(async (i) => {
    const r = await fetch(`/api/orders/${i}`);
    if (!r.ok) return `HTTP ${r.status}`;
    const d = await r.json();
    return d.status === "Posted" ? "Posted" : d.currentStageIndex;
  }, id);
}

// ── 1. raise it through the dialog ───────────────────────────────────────
const coord = await page("sales.coord@gwmc.com");
await coord.goto(`${BASE}/orders`, { waitUntil: "networkidle" });
await coord.waitForTimeout(1200);
await btn(coord, "New order", "طلبية جديدة").click();
await coord.waitForTimeout(700);
const dlg = coord.locator('[role="dialog"]');
await dlg.locator("select").nth(0).selectOption({ index: 1 });
await dlg.locator("input").nth(0).fill(ref);
await dlg.locator("select").nth(1).selectOption({ index: 1 });
await dlg.locator("select").nth(2).selectOption("50");
await dlg.locator('input[type="number"]').first().fill("100");
await btn(dlg, "Raise order", "إنشاء الطلبية").click();
await coord.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 15000 });
await coord.waitForTimeout(1200);

const id = await coord.evaluate(async (q) => {
  const r = await fetch(`/api/orders?search=${encodeURIComponent(q)}`);
  return (await r.json()).orders?.[0]?._id;
}, ref);
ok("order raised through the dialog", !!id, true);
ok("lands at stage 2", await stageOf("sales.coord@gwmc.com", id), 2);
ok("finance cannot see it yet", await stageOf("finance@gwmc.com", id), "HTTP 404");

// ── 2..5. the approval chain, one Approve click each ─────────────────────
const chain = [
  ["sales.manager@gwmc.com", "sales manager approves", 3],
  ["finance@gwmc.com",       "finance approves",       4],
  ["gm@gwmc.com",            "GM approves",            5],
  ["tech.manager@gwmc.com",  "technical approves",     6],
];
for (const [email, label, expect] of chain) {
  const p = await openOrder(email, id);
  const code = await clickAndWait(p, btn(p, "^Approve$", "^اعتماد$"), "/approve");
  ok(`${label} (HTTP ${code})`, await stageOf(email, id), expect);
}

// ── 6. the lab step ──────────────────────────────────────────────────────
const lab = await openOrder("lab.tech@gwmc.com", id);
await btn(lab, "Enter lab results", "إدخال نتائج المختبر").click();
await lab.waitForTimeout(500);
await lab.locator('[role="dialog"]').waitFor({ timeout: 10000 });
await lab.waitForTimeout(1200);
const labDlg = lab.locator('[role="dialog"]');
const boxes = labDlg.locator('input[type="checkbox"]');
const n = await boxes.count();
ok("lab dialog offers samples to attach", n > 0, true);
if (n > 0) {
  await boxes.first().check();
  const lc = await clickAndWait(lab, btn(labDlg, "Attach & continue", "إرفاق ومتابعة"), "/lab");
  await lab.waitForTimeout(1200);
  ok(`lab attaches results -> stage 7 (HTTP ${lc})`, await stageOf("lab.tech@gwmc.com", id), 7);
}

// ── 7. the joint gate: one signature is not enough ───────────────────────
const gm = await openOrder("gm@gwmc.com", id);
await clickAndWait(gm, btn(gm, "^Approve$", "^اعتماد$"), "/approve");
ok("GM signs, order HOLDS at 7", await stageOf("gm@gwmc.com", id), 7);

const tm = await openOrder("tech.manager@gwmc.com", id);
await clickAndWait(tm, btn(tm, "^Approve$", "^اعتماد$"), "/approve");
ok("technical signs too -> stage 8", await stageOf("tech.manager@gwmc.com", id), 8);

// ── 8. weigh & post ──────────────────────────────────────────────────────
const wb = await openOrder("weighbridge@gwmc.com", id);
await btn(wb, "Weigh & post", "الوزن والترحيل").first().click();
await wb.locator('[role="dialog"]').waitFor({ timeout: 10000 });
await wb.waitForTimeout(1000);
const wDlg = wb.locator('[role="dialog"]');
await wDlg.locator('input[type="number"]').fill("4970");   // ordered 5000 kg
const variance = await wDlg.innerText();
ok("dialog previews the variance", /-0\.6|0\.6/.test(variance.replace(/,/g, "")), true);
const wc = await clickAndWait(
  wb,
  wDlg.getByRole("button", { name: new RegExp(AR ? "الوزن والترحيل" : "Weigh & post") }).last(),
  "/weigh"
);
await wb.waitForTimeout(1200);
ok(`weighbridge posts it (HTTP ${wc})`, await stageOf("weighbridge@gwmc.com", id), "Posted");

await (await openOrder("gm@gwmc.com", id)).screenshot({ path: `/tmp/walk-${lang}.png`, fullPage: true });
console.log(`\n${failed ? `${failed} FAILED` : "all passed"} · ${ref} · shot: /tmp/walk-${lang}.png`);
await b.close();
process.exit(failed ? 1 : 0);
