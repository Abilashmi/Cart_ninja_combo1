import { test, expect, STOREFRONT_URL, TEST_PRODUCT_HANDLE } from "../../fixtures/storefront";
import { CartDrawerWidget } from "../../pages/storefront/CartDrawerWidget";

test.use({ baseURL: STOREFRONT_URL });

test.describe("Cart Drawer (storefront, live theme extension)", () => {
  test("adding a product opens the cart drawer with that product in it", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);

    await expect(drawer.addToCartButton).toBeVisible();
    await drawer.addToCart();

    await drawer.waitForOpen();
    expect(await drawer.isOpen()).toBe(true);

    await expect(drawer.subtotalRow).toBeVisible();
    await expect(drawer.checkoutLink).toBeVisible();
  });

  test("quantity +/- buttons are present once an item is in the cart", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);
    await drawer.addToCart();
    await drawer.waitForOpen();

    // The drawer's overlay can flip to "active" slightly before its own
    // /cart.js-driven re-render (it polls every 1.5s and re-renders on other
    // triggers too) has caught up with the just-added item — so this needs a
    // generous, polling-friendly timeout rather than the default 5s.
    await expect(drawer.qtyButtons.first()).toBeVisible({ timeout: 20000 });
    // − and + for at least one line item
    expect(await drawer.qtyButtons.count()).toBeGreaterThanOrEqual(2);
  });

  test("checkout link points at /checkout", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);
    await drawer.addToCart();
    await drawer.waitForOpen();

    await expect(drawer.checkoutLink).toHaveAttribute("href", /^\/checkout/);
  });
});
