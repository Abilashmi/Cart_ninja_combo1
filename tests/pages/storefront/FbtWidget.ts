import type { Page, Locator } from "@playwright/test";

/** Page Object for Frequently Bought Together v2 (extensions/cart-drawer/assets/brix_fbt.js). */
export class FbtWidget {
  readonly page: Page;
  readonly root: Locator;
  readonly title: Locator;
  readonly productCards: Locator;
  readonly addAllButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator("[data-brix-fbt] .bxf");
    this.title = this.root.locator(".bxf-h");
    // Bundle rows or cards, whichever style the store uses.
    this.productCards = this.root.locator(".bxf-li, .bxf-card");
    this.addAllButton = this.root.locator("[data-fbt-addall]");
  }

  async gotoProduct(handle: string) {
    await this.page.goto(`/products/${handle}`);
  }
}
