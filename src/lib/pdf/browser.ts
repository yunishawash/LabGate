import { chromium, type Browser } from "playwright-core";
import fs from "fs";

/**
 * playwright-core ships no browser of its own — it drives whatever Chrome/
 * Chromium is already on the machine. The dev screenshot scripts hard-code the
 * macOS "Google Chrome.app" path, which does not exist on the Linux PM2 box
 * this actually has to render on in production, so resolution here checks an
 * explicit env var first and only falls back to the mac path for local dev.
 *
 * Production setup: install Chrome or Chromium on the server and set
 * `CHROME_EXECUTABLE_PATH` (e.g. `/usr/bin/chromium-browser`) in the env.
 */
function resolveExecutablePath(): string | undefined {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export async function launchPdfBrowser(): Promise<Browser> {
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No Chrome/Chromium executable found for PDF rendering. Set CHROME_EXECUTABLE_PATH in the environment."
    );
  }
  return chromium.launch({ executablePath, headless: true });
}

/** Renders `html` to an A4 PDF buffer with print backgrounds preserved. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    // "load" (not "networkidle") is deliberate: the template is fully
    // self-contained (fonts and logo are inlined as data URIs), so there is
    // no network activity to wait for, and waiting for it anyway would just
    // add latency for nothing.
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
