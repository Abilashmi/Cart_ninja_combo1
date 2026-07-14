import { request } from "@playwright/test";
import { test, expect, PHP_BASE_URL } from "../../fixtures/phpApi";

// Own shop domain per spec file so parallel test files never race on the
// same DB row (php_backend upserts are keyed by shop_domain).
const SHOP = "playwright-test-cart-drawer-config.myshopify.com";

test.describe("cart_drawer_config.php", () => {
  test("GET with no shop param returns 400", async ({ phpApi }) => {
    const res = await phpApi.get("cart_drawer_config.php");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.status).toBe("error");
  });

  test("GET for an unknown shop returns success with null data", async ({ phpApi }) => {
    const res = await phpApi.get("cart_drawer_config.php", {
      params: { shop: "playwright-test-never-seen.myshopify.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.data).toBeNull();
  });

  test("POST persists settings, and GET reflects them back", async ({ phpApi }) => {
    const payload = {
      shop: SHOP,
      is_enabled: 1,
      checkout_button_text: "Proceed to Checkout",
      header_title: "My Playwright Cart",
      position: "left",
      design_width: "thick",
      announcement_enabled: 1,
      announcement_text: "Playwright was here",
    };

    const postRes = await phpApi.post("cart_drawer_config.php", { data: payload });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.status).toBe("success");
    expect(postBody.data.checkout_button_text).toBe("Proceed to Checkout");
    expect(postBody.data.header_title).toBe("My Playwright Cart");
    expect(postBody.data.position).toBe("left");
    expect(Number(postBody.data.announcement_enabled)).toBe(1);

    const getRes = await phpApi.get("cart_drawer_config.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.data.checkout_button_text).toBe("Proceed to Checkout");
    expect(getBody.data.announcement_text).toBe("Playwright was here");
  });

  test("POST twice (upsert) updates the same row rather than duplicating it", async ({ phpApi }) => {
    await phpApi.post("cart_drawer_config.php", {
      data: { shop: SHOP, header_title: "First Title" },
    });
    const secondRes = await phpApi.post("cart_drawer_config.php", {
      data: { shop: SHOP, header_title: "Second Title" },
    });
    const secondBody = await secondRes.json();
    expect(secondBody.data.header_title).toBe("Second Title");

    const getRes = await phpApi.get("cart_drawer_config.php", { params: { shop: SHOP } });
    const getBody = await getRes.json();
    expect(getBody.data.header_title).toBe("Second Title");
  });

  test("secret check is inert on this local backend (documents current env behavior)", async () => {
    // cart_drawer_config.php only enforces X-Forge-Secret when getenv('SHOPIFY_API_KEY')
    // is non-empty in PHP's own process environment. Local XAMPP's config.php never sets
    // that (it's Node's .env, not PHP's env) — so `$expected` is always '', and the
    // `if ($expected && ...)` guard is skipped entirely regardless of what secret is sent.
    // On the deployed remote backend, where SHOPIFY_API_KEY IS set server-side, a wrong
    // secret would correctly get a 403 — this test only reflects the local dev reality.
    const badContext = await request.newContext({
      baseURL: PHP_BASE_URL,
      extraHTTPHeaders: { "X-Forge-Secret": "definitely-wrong-secret" },
    });
    const res = await badContext.get("cart_drawer_config.php", { params: { shop: SHOP } });
    expect(res.status()).toBe(200);
    await badContext.dispose();
  });
});
