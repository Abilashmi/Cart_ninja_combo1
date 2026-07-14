import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env.playwright");
} catch {
  // .env.playwright not present — tests relying on PLAYWRIGHT_APP_URL will fail with a clear message
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Bypasses the ngrok free-tier "are you the developer?" interstitial page
    // that otherwise intercepts every request to the tunneled dev app URL.
    extraHTTPHeaders: {
      "ngrok-skip-browser-warning": "true",
    },
  },
  projects: [
    {
      name: "storefront",
      // Runs serially against the real, live production storefront (Shopify +
      // Cloudflare) — concurrent workers were observed to slow down/contend
      // responses enough that the drawer's config fetch missed its window,
      // causing flaky failures. This is a live shared resource, not a local
      // double, so we trade speed for reliability here.
      testMatch: /specs[\\/]storefront[\\/].*\.spec\.ts/,
      fullyParallel: false,
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: /specs[\\/]storefront[\\/].*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
