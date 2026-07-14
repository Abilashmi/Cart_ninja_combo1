import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-progress-bar.myshopify.com";

test.describe("progress_bar.php", () => {
  test("GET with no shop param returns 400", async ({ phpApi }) => {
    const res = await phpApi.get("progress_bar.php");
    expect(res.status()).toBe(400);
  });

  test("GET for an unknown shop returns success with null data", async ({ phpApi }) => {
    const res = await phpApi.get("progress_bar.php", {
      params: { shop: "playwright-test-never-seen.myshopify.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  test("POST persists settings + tiers, GET reflects them back", async ({ phpApi }) => {
    const payload = {
      shop: SHOP,
      is_enabled: 1,
      mode: "amount",
      bar_foreground_color: "#123456",
      completion_text: "Free shipping unlocked!",
      tiers: [
        { min_value: 499, description: "Free gift", reward_type: "free_gift" },
        { min_value: 999, description: "Free shipping", reward_type: "free_shipping" },
      ],
    };

    const postRes = await phpApi.post("progress_bar.php", { data: payload });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.status).toBe("success");
    expect(postBody.data.bar_foreground_color).toBe("#123456");
    expect(postBody.data.tiers).toHaveLength(2);
    expect(postBody.data.tiers[0].description).toBe("Free gift");
    expect(postBody.data.tiers[1].min_value).toBe("999.00"); // DECIMAL column — PDO returns it as a fixed-precision string

    const getRes = await phpApi.get("progress_bar.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.data.tiers).toHaveLength(2);
  });

  test("re-POSTing with fewer tiers replaces the old tier list, not appends", async ({ phpApi }) => {
    await phpApi.post("progress_bar.php", {
      data: {
        shop: SHOP,
        tiers: [
          { min_value: 100, description: "A" },
          { min_value: 200, description: "B" },
          { min_value: 300, description: "C" },
        ],
      },
    });

    const res = await phpApi.post("progress_bar.php", {
      data: { shop: SHOP, tiers: [{ min_value: 500, description: "Only one now" }] },
    });
    const body = await res.json();
    expect(body.data.tiers).toHaveLength(1);
    expect(body.data.tiers[0].description).toBe("Only one now");
  });
});
