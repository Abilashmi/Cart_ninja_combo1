import { test, expect } from "../../fixtures/phpApi";

const SHOP = "playwright-test-ai-agent-apply.myshopify.com";

test.describe("ai_agent_apply.php (AI action-execution engine)", () => {
  test("missing shop or actions returns 400", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", { data: { shop: SHOP, plan: { actions: [] } } });
    expect(res.status()).toBe(400);
  });

  test("enableDrawer applies and is reflected in the read-back state", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: { shop: SHOP, plan: { actions: ["enableDrawer"] } },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.applied).toEqual(["enableDrawer"]);
    expect(body.after.cart.drawerEnabled).toBe(true);
  });

  test("disableDrawer flips it back off", async ({ phpApi }) => {
    await phpApi.post("ai_agent_apply.php", { data: { shop: SHOP, plan: { actions: ["enableDrawer"] } } });
    const res = await phpApi.post("ai_agent_apply.php", {
      data: { shop: SHOP, plan: { actions: ["disableDrawer"] } },
    });
    const body = await res.json();
    expect(body.after.cart.drawerEnabled).toBe(false);
  });

  test("enableGoalBar with a goalAmount updates the first tier's min_value", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: {
        shop: SHOP,
        plan: {
          actions: ["enableGoalBar"],
          settings: { goalMessage: "Almost there!", goalAmount: 750 },
        },
      },
    });
    const body = await res.json();
    expect(body.applied).toContain("enableGoalBar");
    expect(body.after.cart.goalBar.enabled).toBe(true);

    // Verify the tier itself via the progress_bar.php read path used elsewhere in the suite.
    const pbRes = await phpApi.get("progress_bar.php", { params: { shop: SHOP } });
    const pbBody = await pbRes.json();
    expect(pbBody.data.completion_text).toBe("Almost there!");
    expect(pbBody.data.tiers[0].min_value).toBe("750.00");
  });

  test("enableUpsell and enableFBT (with template) both apply in a single multi-action plan", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: {
        shop: SHOP,
        plan: {
          actions: ["enableUpsell", "enableFBT"],
          settings: { fbtTemplate: "fbt2", fbtMode: "ai" },
        },
      },
    });
    const body = await res.json();
    expect(body.applied.sort()).toEqual(["enableFBT", "enableUpsell"]);
    expect(body.after.cart.upsell.enabled).toBe(true);
    expect(body.after.fbt.widgetEnabled).toBe(true);
  });

  test("applyTheme writes header/checkout colors to cart_drawer_config", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: {
        shop: SHOP,
        plan: {
          actions: ["applyTheme"],
          settings: {
            theme: {
              headerBgColor: "#ff00ff",
              headerTextColor: "#000000",
              checkoutBgColor: "#00ffcc",
              checkoutTextColor: "#111111",
            },
          },
        },
      },
    });
    const body = await res.json();
    expect(body.applied).toEqual(["applyTheme"]);
    expect(body.after.cart.header).toEqual({ bgColor: "#ff00ff", textColor: "#000000" });
    expect(body.after.cart.checkoutButton).toEqual({
      backgroundColor: "#00ffcc",
      textColor: "#111111",
    });
  });

  test("an unrecognized action is reported as unsupported, not silently applied", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: { shop: SHOP, plan: { actions: ["addTrustBadges"] } },
    });
    const body = await res.json();
    expect(body.status).toBe("unsupported");
    expect(body.applied).toEqual([]);
    expect(body.unsupported).toEqual(["addTrustBadges"]);
  });

  test("a mixed plan of one real + one unsupported action reports status 'partial'", async ({ phpApi }) => {
    const res = await phpApi.post("ai_agent_apply.php", {
      data: { shop: SHOP, plan: { actions: ["enableDrawer", "optimizeMobile"] } },
    });
    const body = await res.json();
    expect(body.status).toBe("partial");
    expect(body.applied).toEqual(["enableDrawer"]);
    expect(body.unsupported).toEqual(["optimizeMobile"]);
  });
});
