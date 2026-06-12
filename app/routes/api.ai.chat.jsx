import { authenticate } from "../shopify.server";
import { chat } from "../services/ai-chat.server";
import { createMessage, updateConversation } from "../services/ai-data.server";
import { applyAiActions } from "../services/ai-agent-actions.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";

const NVIDIA_TO_ENGINE_ACTION = {
  enable_cart_drawer: "enableDrawer",
  disable_cart_drawer: "disableDrawer",
  enable_upsell: "enableUpsell",
  disable_upsell: "disableUpsell",
  enable_fbt: "enableFBT",
  disable_fbt: "disableFBT",
  enable_goal_bar: "enableGoalBar",
  disable_goal_bar: "disableGoalBar",
  enable_trust_badges: "enableTrustBadges",
  disable_trust_badges: "disableTrustBadges",
  match_theme: "matchTheme",
  optimize_mobile: "optimizeMobile",
  apply_template: "applyTemplate",
  update_styling: "updateStyling",
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

    // Get AI response
    const result = await chat({ message: userMessage, conversationId, messages: history });

    if (!result.success) {
      return Response.json(result, { status: 500 });
    }

    let executedActions = [];
    let before = null;
    let after = null;
    let synced = false;

    if (result.actions?.length > 0 && !result.off_topic && shop) {
      const engineActions = result.actions
        .map((a) => NVIDIA_TO_ENGINE_ACTION[a.type])
        .filter(Boolean);

      if (engineActions.length > 0) {
        try {
          const themeColors = admin ? await analyzeThemeColors(admin).catch(() => ({})) : {};
          const execResult = await applyAiActions({
            shop,
            actions: engineActions,
            settings: {},
            themeColors,
            dryRun: false,
          });
          executedActions = execResult.appliedActions || [];
          before = execResult.before;
          after = execResult.after;
          synced = execResult.synced;
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
      off_topic: result.off_topic,
      insight_mode: result.insight_mode,
      messageId: assistantMsg.id,
    });
  } catch (e) {
    console.error("[API] chat error:", e);
    return Response.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
