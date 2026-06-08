/**
 * /api/ai-agent/history
 *
 * GET  — list this shop's AI Agent history (prompt, response, applied changes, timestamp).
 * POST — restore a previous entry by re-running its applied actions.
 */

import { authenticate } from "../shopify.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";
import { applyAiActions } from "../services/ai-agent-actions.server";
import { listAiAgentHistory, findAiAgentHistoryEntry, recordAiAgentHistory } from "../services/ai-agent-history.server";

export async function loader({ request }) {
    let shop = "";
    try {
        const auth = await authenticate.admin(request);
        shop = auth?.session?.shop || "";
    } catch (e) {
        console.error("[AI Agent] Unauthorized history request:", e);
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const history = await listAiAgentHistory(shop);
    return Response.json({ success: true, history });
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

    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
    if (!entryId) {
        return Response.json({ error: "entryId is required" }, { status: 400 });
    }

    let admin;
    let shop = "";
    try {
        const auth = await authenticate.admin(request);
        admin = auth?.admin;
        shop = auth?.session?.shop || "";
    } catch (e) {
        console.error("[AI Agent] Unauthorized restore request:", e);
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const entry = await findAiAgentHistoryEntry(shop, entryId);
    if (!entry) {
        return Response.json({ error: "History entry not found." }, { status: 404 });
    }

    const actions = (entry.appliedActions || []).map((a) => a.action).filter(Boolean);
    if (actions.length === 0) {
        return Response.json({ error: "This entry has no actions to restore." }, { status: 400 });
    }

    const themeColors = await analyzeThemeColors(admin);

    try {
        const result = await applyAiActions({
            shop,
            actions,
            settings: entry.response?.settings || {},
            themeColors,
        });

        const historyEntry = await recordAiAgentHistory(shop, {
            prompt: entry.prompt,
            summary: `Restored: ${entry.summary || "previous AI changes"}`,
            response: entry.response,
            appliedActions: result.appliedActions,
            status: "restored",
        });

        return Response.json({
            success: true,
            applied: result.appliedActions,
            before: result.before,
            after: result.after,
            synced: result.synced,
            history: historyEntry,
        });
    } catch (err) {
        console.error("[AI Agent] restore error:", err);
        return Response.json({ error: `Failed to restore changes: ${err?.message || "Unknown error"}` }, { status: 500 });
    }
}
