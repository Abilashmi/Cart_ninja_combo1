import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-fbt-widget.myshopify.com";

// Note: unlike the other widget endpoints, save_fbt_widget.php has no
// X-Forge-Secret gate at all — it's called directly by the storefront via
// the app proxy, so it's intentionally open. GET also uses `shopdomain`
// (not `shop`), and returns a `status: "error"` body (not `success`/null)
// when no row exists yet — different shape than the other widget endpoints.
test.describe("save_fbt_widget.php", () => {
  test("GET with no shopdomain param returns 400", async ({ phpApi }) => {
    const res = await phpApi.get("save_fbt_widget.php");
    expect(res.status()).toBe(400);
  });

  test("GET for a shop with no saved data returns an error body, not success/null", async ({ phpApi }) => {
    const res = await phpApi.get("save_fbt_widget.php", {
      params: { shopdomain: "playwright-test-never-seen.myshopify.com" },
    });
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/no data found/i);
  });

  test("POST persists templates + selected template/mode, GET reflects them back", async ({ phpApi }) => {
    // `shop` is a sibling of `fbt` at the payload's top level, not nested inside it —
    // save_fbt_widget.php reads $payload['shop'] and $payload['fbt'] separately.
    const payload = {
      shop: SHOP,
      fbt: {
        selectedTemplate: "fbt1",
        mode: "manual",
        widgetPlacement: "above_cart",
        isEnabled: true,
        aiProductCount: 3, // fbt_widget.ai_product_count is NOT NULL with no default
        manualRules: [{ trigger: "cotton-pant", offers: ["cargo-pant", "jeans"] }],
        templates: {
          fbt1: {
            bgColor: "#fefefe",
            buttonColor: "#222222",
            layout: "horizontal",
            interactionType: "classic",
          },
        },
      },
    };

    const postRes = await phpApi.post("save_fbt_widget.php", { data: payload });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.status).toBe("success");

    const getRes = await phpApi.get("save_fbt_widget.php", {
      params: { shopdomain: SHOP },
    });
    const getBody = await getRes.json();
    expect(getBody.status).toBe("success");
    expect(getBody.data.selectedTemp).toBe("fbt1");
    expect(getBody.data.selectedMode).toBe("manual");
    expect(getBody.data.temp1.bgColor).toBe("#fefefe");
    expect(getBody.data.condition[0].trigger).toBe("cotton-pant");
  });

  test("plan gating: FBT is not publishable on the default (free) plan", async ({ phpApi }) => {
    // fbt is 'preview' (not 'enabled') on the free plan per plan_config.php,
    // and a shop with no `shops` row resolves to 'free' — so isEnabled must
    // be forced false on read even though the merchant saved isEnabled: true.
    await phpApi.post("save_fbt_widget.php", {
      data: {
        shop: SHOP,
        fbt: {
          selectedTemplate: "fbt1",
          isEnabled: true,
          aiProductCount: 3, // fbt_widget.ai_product_count is NOT NULL with no default
          templates: { fbt1: { isEnabled: true } },
        },
      },
    });

    const res = await phpApi.get("save_fbt_widget.php", { params: { shopdomain: SHOP } });
    const body = await res.json();
    expect(body.data.publishable).toBe(false);
    expect(body.data.isEnabled).toBe(false);
    expect(body.data.temp1.isEnabled).toBe(false);
  });
});
