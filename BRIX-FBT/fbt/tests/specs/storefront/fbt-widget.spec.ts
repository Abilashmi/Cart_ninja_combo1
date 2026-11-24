import { test, expect, STOREFRONT_URL, TEST_PRODUCT_HANDLE } from "../../fixtures/storefront";
import { FbtWidget } from "../../pages/storefront/FbtWidget";

test.use({ baseURL: STOREFRONT_URL });

test.describe("Frequently Bought Together (storefront, live theme extension)", () => {
  test("renders on the product page with the trigger product's recommendations", async ({ page }) => {
    const widget = new FbtWidget(page);
    await widget.gotoProduct(TEST_PRODUCT_HANDLE);

    await expect(widget.root).toBeVisible();
    await expect(widget.title).toHaveText("Frequently Bought Together");
    expect(await widget.productCards.count()).toBeGreaterThan(0);
  });
});
