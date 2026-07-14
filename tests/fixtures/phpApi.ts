import { test as base, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

const rawBaseUrl =
  process.env.PHP_BASE_URL || "http://localhost/cartdrawerv2_ui/php_backend";
// A trailing slash is required here: APIRequestContext resolves request paths
// against baseURL using WHATWG URL rules, so a leading-slash path (e.g.
// "/cart_drawer_config.php") against a baseURL with no trailing slash drops
// the baseURL's path entirely instead of appending to it.
export const PHP_BASE_URL = rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`;

// Dedicated fake shop domain — keeps these tests from ever reading/writing
// the real store's live widget settings, since the PHP backend keys every
// row by shop_domain with no further verification that the shop exists.
export const TEST_SHOP = process.env.TEST_SHOP_DOMAIN || "playwright-e2e-test.myshopify.com";

/**
 * `phpApi` talks to the PHP backend directly using the same shared-secret
 * header (X-Forge-Secret) that Node uses — this never goes through Shopify
 * admin auth at all, so it works without a live embedded session.
 */
export const test = base.extend<{ phpApi: APIRequestContext }>({
  phpApi: async ({}, use) => {
    const context = await playwrightRequest.newContext({
      baseURL: PHP_BASE_URL,
      extraHTTPHeaders: {
        "X-Forge-Secret": process.env.FORGE_SECRET || "",
        "Content-Type": "application/json",
      },
    });
    await use(context);
    await context.dispose();
  },
});

export { expect } from "@playwright/test";
