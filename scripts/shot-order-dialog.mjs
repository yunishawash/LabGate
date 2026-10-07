/**
 * Screenshot the New-order dialog in Arabic, with both a bagged and a bulk
 * line filled in — the two shapes that have to fit side by side.
 *
 * It exists because the dialog's layout bug was invisible in English: the
 * close button sits at the `end` edge, which is the LEFT in RTL, exactly where
 * the header was pinning the title. A screenshot taken in Arabic is the test.
 *
 *   node scripts/shot-order-dialog.mjs <out.png> [ar|en] [width]
 */
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [out = "/tmp/order-dialog.png", lang = "ar", width = "900"] = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3001/login", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', "sales.coord@gwmc.com");
await page.fill('input[name="password"]', "pass123");
await page.click('button[type="submit"]');
for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(500);

/**
 * Language is a COOKIE (`labgate-lang`), not localStorage — the server needs it
 * before it emits the `<html dir>` attribute. Setting localStorage here was a
 * silent no-op that happened to look like it worked, because Arabic is the
 * default and every Arabic run was therefore correct by accident.
 */
await ctx.addCookies([{
  name: "labgate-lang", value: lang,
  domain: "localhost", path: "/",
}]);
await page.goto("http://localhost:3001/orders", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

await page.getByRole("button", { name: lang === "ar" ? /طلبية جديدة/ : /New order/ }).first().click();
await page.waitForTimeout(800);

const dialog = page.locator('[role="dialog"]');

/** Pick the nth option out of a Combobox trigger. */
async function pickCombobox(trigger, optionIndex) {
  await trigger.click();
  await page.waitForTimeout(400);
  const items = page.locator('[cmdk-item]');
  await items.nth(optionIndex).click();
  await page.waitForTimeout(300);
}

// Customer.
await pickCombobox(dialog.locator('[role="combobox"]').first(), 0);

/**
 * Each line renders as one block holding two rows, so scoping to the block is
 * the only stable way to reach "the packaging select of the SECOND line".
 * Counting comboboxes across the whole dialog is not: the count changes with
 * the packaging, which is the very thing being set.
 */
const lineBlocks = () => dialog.locator("div.divide-y > div.p-2\\.5");

async function setLine(index, { productOption = 0, bulk = false, value }) {
  const block = lineBlocks().nth(index);
  await pickCombobox(block.locator('[role="combobox"]').first(), productOption);

  if (bulk) {
    // Second combobox on the block's lower row is the packaging.
    await pickCombobox(block.locator('[role="combobox"]').nth(1), 1);
  }
  const nums = block.locator('input[type="number"]');
  await nums.first().fill(String(value));
  await page.waitForTimeout(300);
}

// Line 1 — a bagged grade of flour.
await setLine(0, { productOption: 0, value: 200 });

// Line 2 — added, then switched to صبّ so both shapes are on screen at once.
await page.getByRole("button", { name: lang === "ar" ? /إضافة بند/ : /Add line/ }).click();
await page.waitForTimeout(500);
await setLine(1, { productOption: 1, bulk: true, value: 28500 });
await page.waitForTimeout(500);

// Does anything stick out sideways? The bug the screenshot was reporting.
const overflow = await dialog.evaluate((el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
  horizontallyScrollable: el.scrollWidth > el.clientWidth,
}));
console.log("dialog overflow:", JSON.stringify(overflow));

// Does the close button overlap the title?
const overlap = await dialog.evaluate((el) => {
  const title = el.querySelector("h2, [id*='title']");
  const close = el.querySelector("button[type='button'] > svg.lucide-x")?.closest("button")
    ?? el.querySelector("button:has(svg)");
  if (!title || !close) return "could not locate both";
  const a = title.getBoundingClientRect();
  const b = close.getBoundingClientRect();
  const hit = !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
  return { titleRect: [a.left, a.top, a.right, a.bottom].map(Math.round), closeRect: [b.left, b.top, b.right, b.bottom].map(Math.round), overlapping: hit };
});
console.log("title/close:", JSON.stringify(overlap));

await page.screenshot({ path: out, fullPage: false });
console.log("saved", out);
await browser.close();
