/**
 * POST /api/ai-agent/apply
 *
 * Executes a previously-previewed AI plan: runs the action engine against the
 * merchant's real cart/upsell/FBT/goal-bar settings, then records the prompt,
 * response, applied changes and timestamp to AI History.
 */

import { authenticate } from "../shopify.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";
import { applyAiActions, SUPPORTED_ACTIONS } from "../services/ai-agent-actions.server";
import { recordAiAgentHistory } from "../services/ai-agent-history.server";
import { getDb } from "../services/db.server";
import crypto from "node:crypto";

function asTrimmedString(value, maxLen = 2000) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const prompt = asTrimmedString(body?.prompt, 1000);
    const summary = asTrimmedString(body?.plan?.summary, 240);
    const actions = Array.isArray(body?.plan?.actions)
        ? body.plan.actions.filter((a) => SUPPORTED_ACTIONS.includes(a))
        : [];
    const planSettings = body?.plan?.settings && typeof body.plan.settings === "object" ? body.plan.settings : {};
    const dryRun = body?.mode === "preview";

    if (actions.length === 0) {
        return Response.json({ error: "There's nothing to apply yet — generate a plan first." }, { status: 400 });
    }

    let admin;
    let shop = "";
    try {
        const auth = await authenticate.admin(request);
        admin = auth?.admin;
        shop = auth?.session?.shop || "";
    } catch (e) {
        console.error("[AI Agent] Unauthorized apply request:", e);
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!shop) {
        return Response.json({ error: "Could not determine the shop for this session." }, { status: 400 });
    }

    const themeColors = await analyzeThemeColors(admin);

    try {
        const result = await applyAiActions({ shop, actions, settings: planSettings, themeColors, dryRun });

        let historyEntry = null;
        if (!dryRun) {
            historyEntry = await recordAiAgentHistory(shop, {
                prompt,
                summary,
                response: { summary, actions, settings: planSettings },
                appliedActions: result.appliedActions,
                status: "applied",
            });

            // Persist applied config to ai_applied_configs for full traceability
            try {
                const db = getDb();
                const configType = actions.some(a => ['configureFBT','enableFBT','disableFBT'].includes(a)) ? 'fbt'
                    : actions.some(a => ['configureUpsell','enableUpsell','disableUpsell'].includes(a)) ? 'upsell'
                    : actions.some(a => ['configureGoalBar','enableGoalBar','disableGoalBar'].includes(a)) ? 'progress_bar'
                    : actions.some(a => ['configureCouponSlider','enableCouponSlider','disableCouponSlider'].includes(a)) ? 'coupon_slider'
                    : actions.some(a => ['configureAnnouncement','enableAnnouncement','disableAnnouncement'].includes(a)) ? 'announcement'
                    : actions.some(a => ['updateStyling','matchTheme','applyTemplate'].includes(a)) ? 'styling'
                    : 'full';

                await db.execute(`
                    INSERT INTO ai_applied_configs
                        (id, shop_domain, config_type, actions_applied, settings_applied,
                         prompt, ai_summary, before_state, after_state, is_active)
                    VALUES (?,?,?,?,?,?,?,?,?,1)
                `, [
                    crypto.randomUUID(),
                    shop,
                    configType,
                    JSON.stringify(result.appliedActions || actions),
                    planSettings ? JSON.stringify(planSettings) : null,
                    prompt || null,
                    summary || null,
                    result.before ? JSON.stringify(result.before) : null,
                    result.after ? JSON.stringify(result.after) : null,
                ]);
            } catch (dbErr) {
                console.error("[AI Agent] Failed to persist ai_applied_configs:", dbErr.message);
            }
        }

        return Response.json({
            success: true,
            dryRun,
            applied: result.appliedActions,
            before: result.before,
            after: result.after,
            rawCartBefore: result.rawCartBefore,
            synced: result.synced,
            verification: result.verification,
            backendResponses: result.backendResponses,
            history: historyEntry,
        });
    } catch (err) {
        console.error("[AI Agent] apply error:", err);
        return Response.json({ error: `Failed to apply changes: ${err?.message || "Unknown error"}` }, { status: 500 });
    }
}
