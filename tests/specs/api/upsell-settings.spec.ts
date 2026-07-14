import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-upsell.myshopify.com";

test.describe("upsell_settings.php", () => {
  test("GET for an unknown shop returns success with null data", async ({ phpApi }) => {
    const res = await phpApi.get("upsell_settings.php", {
      params: { shop: "playwright-test-never-seen.myshopify.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  test("POST persists settings + manual rules, GET reflects them back", async ({ phpApi }) => {
    const payload = {
      shop: SHOP,
      is_enabled: 1,
      title: "You might also like",
      layout: "carousel",
      button_text: "Add",
      manualRules: [
        { triggerProducts: ["cotton-pant"], upsellProducts: ["cargo-pant"] },
      ],
    };

    const postRes = await phpApi.post("upsell_settings.php", { data: payload });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.data.title).toBe("You might also like");
    expect(postBody.data.manual_rules).toHaveLength(1);
    expect(postBody.data.manual_rules[0].triggerProducts).toEqual(["cotton-pant"]);

    const getRes = await phpApi.get("upsell_settings.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.data.manual_rules[0].upsellProducts).toEqual(["cargo-pant"]);
  });

  test("plan gating: is_enabled is forced to 0 on GET when the shop's plan can't publish ai_cart_upsell", async ({ phpApi }) => {
    // This shop has no `shops` row at all, so resolve_plan_key() falls back to
    // the default (lowest) plan, which per plan_config.php doesn't include
    // ai_cart_upsell — the merchant's saved is_enabled=1 should be masked to 0
    // on read without touching the stored value.
    await phpApi.post("upsell_settings.php", {
      data: { shop: SHOP, is_enabled: 1 },
    });

    const res = await phpApi.get("upsell_settings.php", { params: { shop: SHOP } });
    const body = await res.json();
    expect(Number(body.data.is_enabled)).toBe(0);
  });
});
