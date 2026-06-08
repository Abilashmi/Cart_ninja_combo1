/**
 * AI Agent — History
 *
 * Stores prompt → response → applied-changes records per shop so merchants
 * can review and restore previous AI runs. Follows the same external-API +
 * local-JSON-fallback resilience pattern as cartdrawer-config / FBT / coupons.
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const EXTERNAL_HISTORY_API = "https://int.thecartninja.com/save_ai_agent_history.php";
const LOCAL_HISTORY_FILE = path.resolve("ai-agent-history-data.json");
const MAX_ENTRIES_PER_SHOP = 50;

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

async function readLocalMap() {
    try {
        const raw = await fs.readFile(LOCAL_HISTORY_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeLocalMap(map) {
    try {
        await fs.writeFile(LOCAL_HISTORY_FILE, JSON.stringify(map, null, 2));
    } catch (e) {
        console.warn("[AI Agent] Failed to persist history locally:", e?.message);
    }
}

export async function listAiAgentHistory(shop) {
    const shopKey = normalizeShopDomain(shop);
    if (!shopKey) return [];

    const map = await readLocalMap();
    const entries = Array.isArray(map[shopKey]) ? map[shopKey] : [];
    return [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export async function recordAiAgentHistory(shop, entry) {
    const shopKey = normalizeShopDomain(shop);
    if (!shopKey) return null;

    const record = {
        id: crypto.randomUUID(),
        prompt: entry.prompt || "",
        summary: entry.summary || "",
        response: entry.response || null,
        appliedActions: Array.isArray(entry.appliedActions) ? entry.appliedActions : [],
        status: entry.status || "applied", // 'previewed' | 'applied' | 'restored'
        timestamp: new Date().toISOString(),
    };

    const map = await readLocalMap();
    const existing = Array.isArray(map[shopKey]) ? map[shopKey] : [];
    map[shopKey] = [record, ...existing].slice(0, MAX_ENTRIES_PER_SHOP);
    await writeLocalMap(map);

    // Best-effort sync to the external backend — failures never block the UI.
    try {
        await fetch(EXTERNAL_HISTORY_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ shop, shopDomain: shop, entry: record }),
        });
    } catch (e) {
        console.warn("[AI Agent] External history sync unavailable (local copy saved):", e?.message);
    }

    return record;
}

export async function findAiAgentHistoryEntry(shop, entryId) {
    const entries = await listAiAgentHistory(shop);
    return entries.find((e) => e.id === entryId) || null;
}
