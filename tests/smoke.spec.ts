import { test, expect } from "@playwright/test";

test("app server responds without a fatal error", async ({ page }) => {
  const url = process.env.PLAYWRIGHT_APP_URL;
  test.skip(!url, "PLAYWRIGHT_APP_URL is not set — see .env.playwright");

  const response = await page.goto(url!, { waitUntil: "domcontentloaded" });

  expect(response, "navigation should return an HTTP response").not.toBeNull();
  expect(
    response!.status(),
    `expected a non-5xx status, got ${response!.status()}`
  ).toBeLessThan(500);

  await page.screenshot({
    path: "test-results/app-smoke.png",
    fullPage: true,
  });
});
