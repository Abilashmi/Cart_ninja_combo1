import { test, expect } from "../../fixtures/phpApi";

// Cross-cutting error-handling behavior shared across the PHP backend's
// widget-settings endpoints (they all follow the same request-handling shape).
const ENDPOINTS = [
  "cart_drawer_config.php",
  "progress_bar.php",
  "coupon_slider_settings.php",
  "upsell_settings.php",
];

test.describe("PHP backend error handling", () => {
  for (const endpoint of ENDPOINTS) {
    test(`${endpoint}: malformed JSON body is treated as empty, not a 500`, async ({ phpApi }) => {
      const res = await phpApi.post(endpoint, {
        headers: { "Content-Type": "application/json" },
        data: "{not valid json" as unknown as Record<string, unknown>,
      });
      // json_decode(...) ?? [] swallows the parse error, so this degrades to
      // "shop required" (400) rather than a fatal error — worth pinning down
      // since a future refactor could easily drop that `?? []` fallback.
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.status).toBe("error");
    });

    test(`${endpoint}: unsupported HTTP method returns 405`, async ({ phpApi }) => {
      const res = await phpApi.delete(endpoint);
      expect(res.status()).toBe(405);
    });

    test(`${endpoint}: empty POST body is treated as "shop required", not a crash`, async ({ phpApi }) => {
      const res = await phpApi.post(endpoint, { data: {} });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.message).toMatch(/shop required/i);
    });
  }

  test("ai_agent_apply.php: malformed JSON body is treated as empty, not a 500", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      headers: { "Content-Type": "application/json" },
      data: "{not valid json" as unknown as Record<string, unknown>,
    });
    expect(res.status()).toBe(400);
  });

  test("ai_conversations.php: unsupported HTTP method returns 405", async ({ phpApi }) => {
    const res = await phpApi.delete("ai_conversations.php");
    expect(res.status()).toBe(405);
  });
});
