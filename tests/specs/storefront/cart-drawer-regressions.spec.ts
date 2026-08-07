import { test, expect, STOREFRONT_URL, TEST_PRODUCT_HANDLE } from "../../fixtures/storefront";
import { CartDrawerWidget } from "../../pages/storefront/CartDrawerWidget";

test.use({ baseURL: STOREFRONT_URL });

/**
 * Regression coverage for three specific bugs fixed in
 * extensions/cart-drawer/assets/cart_drawer_inline.js:
 *   1. Double cart drawer (native theme drawer + ours both opening)
 *   2. Add to Cart doubling quantity (duplicate /cart/add.js POST)
 *   3. Script re-execution re-registering listeners (missing boot guard)
 *
 * IMPORTANT: these test the CURRENTLY DEPLOYED extension asset on
 * STOREFRONT_URL — Shopify serves it from the CDN via `npm run deploy`, not
 * from the local working tree. Local code edits are invisible here until
 * deployed. Re-run this file after deploying to get a real result for the
 * fixes made in this session.
 */
test.describe("Cart Drawer — duplicate add-to-cart / double-drawer regressions", () => {
  test("clicking Add to Cart once sends exactly one /cart/add.js request", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);
    await expect(drawer.addToCartButton).toBeVisible();

    const addToCartRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/cart/add")) {
        addToCartRequests.push(req.url());
      }
    });

    await drawer.addToCart();
    await drawer.waitForOpen();
    // Give any (bug) duplicate request a real chance to land before asserting.
    await page.waitForTimeout(2000);

    expect(
      addToCartRequests.length,
      `expected exactly 1 POST to /cart/add(.js), saw ${addToCartRequests.length}: ${addToCartRequests.join(", ")}`
    ).toBe(1);
  });

  test("our drawer opens without any known native theme drawer becoming visible at the same time", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);
    await drawer.addToCart();
    await drawer.waitForOpen();
    expect(await drawer.isOpen()).toBe(true);

    // Mirrors the CC_DRAWER_TAGS / CC_DRAWER_IDS / class-heuristics used in
    // cart_drawer_inline.js's own native-drawer identification, so this
    // check tracks whatever the app itself considers "a native drawer" —
    // update alongside that list if it changes.
    const visibleNativeDrawers = await page.evaluate(() => {
      const TAGS = ["cart-notification", "cart-drawer", "mini-cart", "drawer-component", "sidebar-cart", "ajax-cart"];
      const IDS = ["CartDrawer", "cart-sidebar", "MiniCart", "mini-cart", "ajax-cart", "CartContainer", "slideout-cart", "slide-cart", "flyout-cart"];
      const CLASS_HINTS = ["cart-drawer", "mini-cart", "ajax-cart", "cart-sidebar", "drawer--cart", "drawer--right", "mini_cart", "cart_container"];
      const OPEN_CLASSES = ["open", "is-open", "is-visible", "active", "is-active", "show", "cart--open", "drawer--is-open", "drawer--open", "drawer--visible"];

      const candidates = new Set<Element>();
      TAGS.forEach((t) => document.querySelectorAll(t).forEach((el) => candidates.add(el)));
      IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el) candidates.add(el);
      });
      document.querySelectorAll("[class]").forEach((el) => {
        const cls = el.className;
        if (typeof cls === "string" && CLASS_HINTS.some((hint) => cls.includes(hint))) candidates.add(el);
      });

      const openAndVisible: string[] = [];
      candidates.forEach((el) => {
        if (el.id === "cc-root" || el.closest("#cc-root")) return; // exclude our own drawer
        const hasOpenClass = OPEN_CLASSES.some((c) => el.classList.contains(c));
        const style = window.getComputedStyle(el as HTMLElement);
        const isVisible = style.display !== "none" && style.visibility !== "hidden" && (el as HTMLElement).offsetParent !== null;
        if (hasOpenClass && isVisible) {
          openAndVisible.push(el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.className ? `.${String(el.className).split(" ").join(".")}` : ""));
        }
      });
      return openAndVisible;
    });

    expect(
      visibleNativeDrawers,
      `expected no native drawer visibly open alongside ours, found: ${visibleNativeDrawers.join(", ")}`
    ).toEqual([]);
  });

  test("boot guard: window.__CC_BOOTED__ is set exactly once and survives a simulated section reload", async ({ page }) => {
    const drawer = new CartDrawerWidget(page);
    await drawer.gotoProduct(TEST_PRODUCT_HANDLE);
    await expect(drawer.addToCartButton).toBeVisible();

    const bootedAfterFirstLoad = await page.evaluate(() => (window as any).__CC_BOOTED__);
    expect(bootedAfterFirstLoad).toBe(true);

    // Simulate the theme editor / AJAX section reload re-inserting our
    // <script src> tag, which browsers re-execute on insertion.
    await page.evaluate(() => {
      const original = document.querySelector('script[src*="cart_drawer_inline.js"]') as HTMLScriptElement | null;
      if (!original) throw new Error("cart_drawer_inline.js script tag not found on page");
      const clone = document.createElement("script");
      clone.src = original.src;
      document.body.appendChild(clone);
    });
    // Let the re-executed script run its (should-be-skipped) init path.
    await page.waitForTimeout(1000);

    const addToCartRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/cart/add")) {
        addToCartRequests.push(req.url());
      }
    });

    await drawer.addToCart();
    await drawer.waitForOpen();
    await page.waitForTimeout(2000);

    // The real, meaningful assertion: even after a forced re-execution
    // attempt, Add to Cart must still fire exactly once — proving the guard
    // prevented a second delegated submit listener from being registered.
    expect(
      addToCartRequests.length,
      `expected exactly 1 POST to /cart/add(.js) even after simulated script re-execution, saw ${addToCartRequests.length}`
    ).toBe(1);
  });
});
