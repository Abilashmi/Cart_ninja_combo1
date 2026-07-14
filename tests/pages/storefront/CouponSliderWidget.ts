import type { Page, Locator } from "@playwright/test";

/** Page Object for the Coupon Slider (extensions/cart-drawer/blocks/coupon_slider.liquid). */
export class CouponSliderWidget {
  readonly page: Page;
  readonly root: Locator;
  readonly title: Locator;
  readonly copyButtons: Locator;
  readonly prevButton: Locator;
  readonly nextButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator("ps-coupon-slider");
    this.title = this.root.locator(".ps-section-title");
    this.copyButtons = this.root.locator(".ps-btn");
    this.prevButton = this.root.locator(".ps-prev");
    this.nextButton = this.root.locator(".ps-next");
  }

  async gotoProduct(handle: string) {
    await this.page.goto(`/products/${handle}`);
  }

  async copyFirstCoupon() {
    await this.copyButtons.first().click();
  }
}
