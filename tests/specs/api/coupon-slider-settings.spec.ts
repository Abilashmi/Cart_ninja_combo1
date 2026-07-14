import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-coupon-slider.myshopify.com";

test.describe("coupon_slider_settings.php", () => {
  test("GET for an unknown shop returns success with null data", async ({ phpApi }) => {
    const res = await phpApi.get("coupon_slider_settings.php", {
      params: { shop: "playwright-test-never-seen.myshopify.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  test("POST persists settings + selected coupons array, GET reflects them back", async ({ phpApi }) => {
    const payload = {
      shop: SHOP,
      is_enabled: 1,
      selected_template: "template2",
      title_text: "Grab a Deal",
      position: "below_cart",
      selectedCoupons: ["SAVE10", "SAVE20"],
      display_condition: "product",
      product_handles: "cotton-pant,cargo-pant",
    };

    const postRes = await phpApi.post("coupon_slider_settings.php", { data: payload });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.data.title_text).toBe("Grab a Deal");
    expect(postBody.data.selected_coupons).toEqual(["SAVE10", "SAVE20"]);
    expect(postBody.data.display_condition).toBe("product");

    const getRes = await phpApi.get("coupon_slider_settings.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.data.selected_coupons).toEqual(["SAVE10", "SAVE20"]);
    expect(getBody.data.product_handles).toBe("cotton-pant,cargo-pant");
  });

  test("gotcha: omitting selectedCoupons on a later POST clears existing coupons to null", async ({ phpApi }) => {
    // coupon_slider_settings.php builds `selected_coupons = VALUES(selected_coupons)` from
    // whatever this request's payload contained (defaulting to null when absent) — it does
    // NOT preserve the previously stored list on a partial update. Documenting actual
    // behavior here since any future caller that sends a partial payload will silently wipe
    // the merchant's selected coupons.
    await phpApi.post("coupon_slider_settings.php", {
      data: { shop: SHOP, selectedCoupons: ["KEEPME"] },
    });
    await phpApi.post("coupon_slider_settings.php", {
      data: { shop: SHOP, title_text: "Unrelated update" },
    });

    const res = await phpApi.get("coupon_slider_settings.php", { params: { shop: SHOP } });
    const body = await res.json();
    expect(body.data.title_text).toBe("Unrelated update");
    expect(body.data.selected_coupons).toEqual([]);
  });
});
