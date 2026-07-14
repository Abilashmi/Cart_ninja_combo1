import { test, expect, STOREFRONT_URL, TEST_PRODUCT_HANDLE } from "../../fixtures/storefront";
import { CouponSliderWidget } from "../../pages/storefront/CouponSliderWidget";

test.use({ baseURL: STOREFRONT_URL });

test.describe("Coupon Slider (storefront, live theme extension)", () => {
  test("renders on the product page with at least one coupon", async ({ page }) => {
    const widget = new CouponSliderWidget(page);
    await widget.gotoProduct(TEST_PRODUCT_HANDLE);

    await expect(widget.root).toBeVisible();
    await expect(widget.title).toBeVisible();
    expect(await widget.copyButtons.count()).toBeGreaterThan(0);
  });

  test("clicking Copy Code copies the coupon and updates the button to 'Copied!'", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-write", "clipboard-read"]);
    const widget = new CouponSliderWidget(page);
    await widget.gotoProduct(TEST_PRODUCT_HANDLE);

    const firstButton = widget.copyButtons.first();
    const code = await firstButton.getAttribute("data-code");
    expect(code).toBeTruthy();

    await widget.copyFirstCoupon();
    await expect(firstButton).toHaveText("Copied!");

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(code);
  });
});
