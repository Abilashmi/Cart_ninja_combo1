import type { Page, Locator } from "@playwright/test";

/** Page Object for Frequently Bought Together (extensions/cart-drawer/blocks/Fbt.liquid). */
export class FbtWidget {
  readonly page: Page;
  readonly root: Locator;
  readonly title: Locator;
  readonly productCards: Locator;
  readonly addAllButton: Locator;
  readonly navPrev: Locator;
  readonly navNext: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator("ps-fbt-widget");
    this.title = this.root.locator(".ps-fbt-title");
    this.productCards = this.root.locator(".ps-product-card");
    this.addAllButton = this.root.locator(".ps-fbt-addall");
    this.navPrev = this.root.locator(".ps-fbt-nav-prev");
    this.navNext = this.root.locator(".ps-fbt-nav-next");
  }

  async gotoProduct(handle: string) {
    await this.page.goto(`/products/${handle}`);
  }
}
