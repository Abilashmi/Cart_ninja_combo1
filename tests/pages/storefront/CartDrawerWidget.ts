import type { Page, Locator } from "@playwright/test";

/** Page Object for the live Cart Drawer (extensions/cart-drawer/assets/cart_drawer_inline.js). */
export class CartDrawerWidget {
  readonly page: Page;
  readonly overlay: Locator;
  readonly drawer: Locator;
  readonly drawerBody: Locator;
  readonly addToCartButton: Locator;
  /** The drawer has no stable class/id hooks per line item — it renders plain
   * inline-styled divs — so interactions target the one stable hook that
   * does exist: the qty +/- buttons (class="cc-qty-btn") and the checkout
   * link (href starts with /checkout, text defaults to "Checkout Now"). */
  readonly checkoutLink: Locator;
  readonly subtotalRow: Locator;
  readonly qtyButtons: Locator;

  constructor(page: Page) {
    this.page = page;
    this.overlay = page.locator("#cc-overlay");
    this.drawer = page.locator("#cc-drawer");
    this.drawerBody = page.locator("#cc-drawer-body");
    this.addToCartButton = page.locator('button[name="add"]').first();
    // Scoped to #cc-drawer specifically — the theme's own native (hidden)
    // cart drawer also contains a "Subtotal" heading in the DOM, so an
    // unscoped page-wide text search matches both and is ambiguous.
    this.checkoutLink = this.drawer.locator('a[href^="/checkout"]');
    this.subtotalRow = this.drawer.getByText("Subtotal", { exact: true });
    this.qtyButtons = this.drawer.locator(".cc-qty-btn");
  }

  async gotoProduct(handle: string) {
    await this.page.goto(`/products/${handle}`);
  }

  async addToCart() {
    await this.addToCartButton.click();
  }

  async waitForOpen(timeout = 15000) {
    await this.page.waitForFunction(
      () => document.querySelector("#cc-overlay")?.classList.contains("active"),
      undefined,
      { timeout }
    );
  }

  async isOpen(): Promise<boolean> {
    return this.overlay
      .evaluate((el) => el.classList.contains("active"))
      .catch(() => false);
  }

  async close() {
    await this.page.locator("#cc-backdrop").click({ force: true }).catch(() => {});
  }

  /** Product title text appears verbatim inside the drawer body per item. */
  productInCart(title: string): Locator {
    return this.drawerBody.getByText(title, { exact: false });
  }
}
