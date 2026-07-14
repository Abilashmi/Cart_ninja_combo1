import { test as base, expect } from "@playwright/test";

export const STOREFRONT_URL =
  process.env.STOREFRONT_URL || "https://cartstoreviewer.myshopify.com";
export const STOREFRONT_PASSWORD = process.env.STOREFRONT_PASSWORD || "";
export const TEST_PRODUCT_HANDLE = process.env.TEST_PRODUCT_HANDLE || "";

/**
 * Unlocks the dev store's password gate once per test by POSTing the
 * password via the shared request context (cookies land in the same
 * context's jar automatically, so subsequent page.goto() calls sail through).
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    if (STOREFRONT_PASSWORD) {
      await context.request.post(`${STOREFRONT_URL}/password`, {
        form: { password: STOREFRONT_PASSWORD },
      });
    }
    await use(context);
  },
});

export { expect };
