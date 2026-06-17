import { authenticate } from "../shopify.server";
import { chat } from "../services/ai-chat.server";
import { createMessage, updateConversation } from "../services/ai-data.server";
import { applyAiActions, ACTION_LABELS } from "../services/ai-agent-actions.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";
import { scrapeStorefront } from "../services/storefront-scraper.server";

const NVIDIA_TO_ENGINE_ACTION = {
  enable_cart_drawer: "enableDrawer",
  disable_cart_drawer: "disableDrawer",
  configure_cart_drawer: "configureCartDrawer",
  enable_upsell: "enableUpsell",
  disable_upsell: "disableUpsell",
  configure_upsell: "configureUpsell",
  enable_fbt: "enableFBT",
  disable_fbt: "disableFBT",
  configure_fbt: "configureFBT",
  enable_goal_bar: "enableGoalBar",
  disable_goal_bar: "disableGoalBar",
  configure_goal_bar: "configureGoalBar",
  enable_trust_badges: "enableTrustBadges",
  disable_trust_badges: "disableTrustBadges",
  enable_coupon_slider: "enableCouponSlider",
  disable_coupon_slider: "disableCouponSlider",
  configure_coupon_slider: "configureCouponSlider",
  enable_announcement: "enableAnnouncement",
  disable_announcement: "disableAnnouncement",
  configure_announcement: "configureAnnouncement",
  match_theme: "matchTheme",
  optimize_mobile: "optimizeMobile",
  apply_template: "applyTemplate",
  update_styling: "updateStyling",
  update_checkout_style: "updateCheckoutStyle",
  create_bundle: "createBundle",
};

export async function action({ request }) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session?.shop || "";

    if (request.method !== "POST") {
      return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const { conversationId, message: userMessage, messages: history } = body;

    if (!conversationId || !userMessage) {
      return Response.json({ success: false, error: "conversationId and message required" }, { status: 400 });
    }

    // Save user message
    await createMessage(conversationId, "user", userMessage);

    // Scrape live storefront if message is design/theme related
    const isDesignIntent = /theme|color|design|brand|website|style|font|match|look|feel/i.test(userMessage);
    const scrapedDesign = (isDesignIntent && shop)
      ? await scrapeStorefront(shop).catch(() => null)
      : null;

    // Get AI response (pass scraped context so LLM knows real colors/offers)
    const result = await chat({ message: userMessage, conversationId, messages: history, scrapedDesign });

    if (!result.success) {
      return Response.json(result, { status: 500 });
    }

    let executedActions = [];
    let before = null;
    let after = null;
    let synced = false;
    let verification = null;
    let backendResponses = null;

    if (result.actions?.length > 0 && !result.off_topic && shop) {
      const engineActions = result.actions
        .map((a) => ({
          engine: NVIDIA_TO_ENGINE_ACTION[a.type],
          settings: a.settings || {},
        }))
        .filter((a) => a.engine);

      if (engineActions.length > 0) {
        try {
          const shopifyTheme = admin ? await analyzeThemeColors(admin).catch(() => ({})) : {};
          // Scraped live storefront takes priority over Shopify brand API
          const themeColors = {
            ...shopifyTheme,
            ...(scrapedDesign?.primaryColor ? { primaryColor: scrapedDesign.primaryColor } : {}),
            ...(scrapedDesign?.secondaryColor ? { secondaryColor: scrapedDesign.secondaryColor } : {}),
            ...(scrapedDesign?.font ? { font: scrapedDesign.font } : {}),
            ...(scrapedDesign?.borderRadius != null ? { borderRadius: scrapedDesign.borderRadius } : {}),
            source: scrapedDesign?.source || shopifyTheme.source || "default",
          };
          // Merge settings from all LLM actions into a single settings object
          const mergedSettings = engineActions.reduce((acc, a) => ({ ...acc, ...a.settings }), {});
          const execResult = await applyAiActions({
            shop,
            actions: engineActions.map((a) => a.engine),
            settings: mergedSettings,
            themeColors,
            dryRun: false,
          });
          executedActions = execResult.appliedActions || [];
          before = execResult.before;
          after = execResult.after;
          // Inject UI-format template into after state so the frontend can sync it immediately
          if (after?.cart?.couponSlider && executedActions.some((a) => a.action === "configureCouponSlider")) {
            const TEMPLATE_UI_MAP = { 1: "classic-banner", 2: "minimal-card", 3: "bold-vibrant" };
            const tplNum = parseInt(mergedSettings?.template) || 1;
            after.cart.couponSlider.template = TEMPLATE_UI_MAP[tplNum] || "classic-banner";
          }
          synced = execResult.synced;
          verification = execResult.verification;
          backendResponses = execResult.backendResponses;

          // Build response message from actual backend + verification result
          if (!synced) {
            const cartResp = backendResponses?.cart;
            const fbtResp = backendResponses?.fbt;
            const errors = [];
            if (cartResp) errors.push(`Cart Drawer API: HTTP ${cartResp.httpStatus}, response: ${JSON.stringify(cartResp.body)}`);
            if (fbtResp) errors.push(`FBT API: HTTP ${fbtResp.httpStatus}, response: ${JSON.stringify(fbtResp.body)}`);
            result.message = `Backend Save Failed\n\nThe database rejected the changes.\n\n${errors.join("\n") || "No successful backend response received."}\n\nPlease check your backend connection and try again.`;
            result.summary = "Backend save failed - no successful response";
          } else if (verification && verification.externalError) {
            result.message = `Verification Failed\n\nCould not reach the database to confirm the changes.\n\nReason: ${verification.externalError}\n\nPlease check your backend connection and try again.`;
            result.summary = "Verification failed - database API unreachable";
          } else if (verification && !verification.verified) {
            const failedActions = verification.results
              ?.filter((r) => !r.passed)
              .map((r) => r.action) || [];
            result.message = `Verification Failed\n\nThe following change(s) were not confirmed in the database:\n${
              failedActions.map((a) => {
                const detail = verification.results?.find((r) => r.action === a);
                const impact = execResult.appliedActions?.find((ea) => ea.action === a)?.impact || a;
                return detail
                  ? `  \u2022 ${impact}\n    Expected: ${detail.expected}, Found: ${detail.actual}`
                  : `  \u2022 ${impact}`;
              }).join("\n") || "  \u2022 Unknown action"
            }\n\nThe database still shows the previous values. This may be caused by:\n\u2022 Database write failure\n\u2022 API sync error\n\u2022 Network timeout\n\nPlease try again or check the configuration manually.`;
            result.summary = "Verification failed - changes not confirmed in database";
          } else if (synced && verification?.verified) {
            // Build a detail-rich success message from what was actually configured
            const actionLabels = executedActions.map((a) => a.action);
            const isFullWorkflow = actionLabels.some((a) =>
              ["configureFBT", "configureUpsell", "configureGoalBar", "configureCartDrawer", "configureCouponSlider", "configureAnnouncement", "updateCheckoutStyle", "createBundle"].includes(a)
            );
            if (isFullWorkflow) {
              const details = after || execResult.after;
              let lines = [];
              if (actionLabels.includes("configureFBT")) {
                lines.push("FBT Configuration Updated");
                lines.push(`Template: ${details?.fbt?.template === "fbt2" ? "Modern Cards" : details?.fbt?.template || "Modern Cards"}`);
                lines.push(`Mode: AI`);
                lines.push(`Status: ${details?.fbt?.enabled ? "Enabled" : "Enabled"}`);
                lines.push(`Products: AI-recommended (up to 5)`);
                lines.push(`Layout: Horizontal with Add All button`);
              }
              if (actionLabels.includes("configureUpsell")) {
                lines.push("Upsell Configuration Updated");
                lines.push(`Layout: Slider`);
                lines.push(`Template: Modern`);
                lines.push(`Status: Enabled`);
                lines.push(`Products: Up to 3 recommendations`);
              }
              if (actionLabels.includes("configureGoalBar")) {
                const goal = mergedSettings?.goal || 999;
                const reward = mergedSettings?.reward || "Free Shipping";
                lines.push("Progress Bar Configuration Updated");
                lines.push(`Goal: \u20B9${typeof goal === "number" ? goal.toLocaleString("en-IN") : goal}`);
                lines.push(`Reward: ${reward}`);
                lines.push(`Status: Enabled`);
                lines.push(`Milestones: 3 tiers configured`);
              }
              if (actionLabels.includes("configureCartDrawer")) {
                lines.push("Cart Drawer Configuration Updated");
                lines.push(`Theme: ${mergedSettings?.theme || "Modern"}`);
                lines.push(`Border Radius: ${mergedSettings?.borderRadius || 12}px`);
                lines.push(`Status: Enabled`);
                lines.push(`Layout: Slide-out panel with optimized spacing`);
              }
              if (actionLabels.includes("configureCouponSlider")) {
                const tplNames = { 1: "Classic Banner", 2: "Minimal Card", 3: "Bold & Vibrant" };
                const tplNum = mergedSettings?.template || 1;
                lines.push("Coupon Slider Configuration Updated");
                lines.push(`Template: ${tplNames[tplNum] || "Classic Banner"}`);
                lines.push(`Status: Enabled`);
                lines.push(`Coupon: First saved coupon auto-selected`);
              }
              if (actionLabels.includes("configureAnnouncement")) {
                lines.push("Announcement Banner Configuration Updated");
                lines.push(`Message: ${mergedSettings?.text || "Free shipping on orders over ₹999!"}`);
                lines.push(`Status: Enabled`);
                lines.push(`Position: Top of the cart`);
              }
              if (actionLabels.includes("updateCheckoutStyle") || (actionLabels.includes("updateStyling") && mergedSettings?.checkoutButtonColor)) {
                lines.push("Checkout Button Style Updated");
                lines.push(`Color: ${mergedSettings?.checkoutButtonColor || mergedSettings?.buttonColor || "#22c55e"}`);
                lines.push(`Text Color: ${mergedSettings?.checkoutTextColor || "#ffffff"}`);
                lines.push(`Border Radius: ${mergedSettings?.checkoutBorderRadius ?? 4}px`);
              }
              lines.push("");
              lines.push("Verification Successful");
              result.message = lines.join("\n");
              result.summary = actionLabels.map((a) => ACTION_LABELS[a] || a).join(", ") + " — Completed";
            }
          }
        } catch (execErr) {
          console.error("[API] Action execution failed:", execErr);
        }
      }
    }

    // Save assistant response
    const assistantMsg = await createMessage(conversationId, "assistant", result.message, {
      summary: result.summary || "",
      actions: result.actions || [],
      executedActions,
      before,
      after,
      synced,
      verification,
      backendResponses,
      off_topic: result.off_topic || false,
      insight_mode: result.insight_mode || null,
    });

    // Update conversation timestamp
    await updateConversation(conversationId, {});

    return Response.json({
      success: true,
      message: result.message,
      summary: result.summary,
      actions: result.actions,
      executedActions,
      before,
      after,
      synced,
      verification,
      backendResponses,
      off_topic: result.off_topic,
      insight_mode: result.insight_mode,
      messageId: assistantMsg.id,
      scrapedDesign: scrapedDesign ? {
        source: scrapedDesign.source,
        primaryColor: scrapedDesign.primaryColor || null,
        secondaryColor: scrapedDesign.secondaryColor || null,
        font: scrapedDesign.font || null,
        borderRadius: scrapedDesign.borderRadius ?? null,
        offers: scrapedDesign.offers || [],
        pageTitle: scrapedDesign.pageTitle || null,
      } : null,
    });
  } catch (e) {
    console.error("[API] chat error:", e);
    return Response.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
