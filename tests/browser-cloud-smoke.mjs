import assert from "node:assert/strict";
const engines = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.env.BROWSER_ENGINE || "chromium";
const browser = await engines[engine].launch({
  ...(engine === "chromium" && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/auth/v1/settings", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ external: { google: false } })
  }));
  const url = process.env.APP_URL || "http://localhost:8765/Index.html";
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("cloud-status").textContent.includes("Login Google ainda não configurado"));
  assert.equal(await page.locator("#cloud-sync").isDisabled(), true);
  await page.click("#cloud-login");
  await page.waitForFunction(() => document.getElementById("cloud-status").textContent.includes("Ative o provedor Google"));
  assert.equal(page.url(), url);
  assert.equal(await page.locator("#cloud-login").isEnabled(), true);
  assert.deepEqual(errors, []);
  await page.locator("#cloud-title").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `/tmp/vocalizando-cloud-${engine}.png` });
  console.log("Cloud browser checks passed: local SDK, disabled provider, no erroneous redirect, preserved local mode.");
} finally {
  await browser.close();
}
