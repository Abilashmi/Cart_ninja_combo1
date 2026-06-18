/**
 * AI Agent — History
 *
 * Stores prompt → response → applied-changes records per shop in MySQL
 * (ai_agent_history table). Falls back to local JSON if the DB is
 * unavailable so the UI never hard-errors.
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "./db.server.js";

const LOCAL_HISTORY_FILE = path.resolve("ai-agent-history-data.json");
const MAX_ENTRIES_PER_SHOP = 50;

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

function toMySQLDateTime(iso) {
    try { return new Date(iso).toISOString().slice(0, 19).replace("T", " "); } catch { return new Date().toISOString().slice(0, 19).replace("T", " "); }
}

// ── Local JSON fallback (read-only on failure, write as backup) ───────────────

async function readLocalMap() {
    try {
        const raw = await fs.readFile(LOCAL_HISTORY_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
}

async function writeLocalMap(map) {
    try { await fs.writeFile(LOCAL_HISTORY_FILE, JSON.stringify(map, null, 2)); } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listAiAgentHistory(shop) {
    const shopKey = normalizeShopDomain(shop);
    if (!shopKey) return [];

    try {
        const db = getDb();
        const [rows] = await db.execute(
            "SELECT * FROM ai_agent_history WHERE shopDomain = ? ORDER BY createdAt DESC LIMIT ?",
            [shopKey, MAX_ENTRIES_PER_SHOP]
        );
        return rows.map(r => ({
            id: r.id,
            prompt: r.prompt || "",
            summary: r.summary || "",
            response: r.response ? (typeof r.response === "string" ? JSON.parse(r.response) : r.response) : null,
            appliedActions: r.appliedActions ? (typeof r.appliedActions === "string" ? JSON.parse(r.appliedActions) : r.appliedActions) : [],
            status: r.status || "applied",
            timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        }));
    } catch (e) {
        console.warn("[AI History] MySQL read failed, using local JSON fallback:", e?.message);
        const map = await readLocalMap();
        const entries = Array.isArray(map[shopKey]) ? map[shopKey] : [];
        return [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
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
        status: entry.status || "applied",
        timestamp: new Date().toISOString(),
    };

    // Write to MySQL (primary)
    try {
        const db = getDb();
        await db.execute(
            "INSERT INTO ai_agent_history (id, shopDomain, prompt, summary, response, appliedActions, status, createdAt) VALUES (?,?,?,?,?,?,?,?)",
            [
                record.id,
                shopKey,
                record.prompt,
                record.summary,
                record.response ? JSON.stringify(record.response) : null,
                record.appliedActions.length ? JSON.stringify(record.appliedActions) : null,
                record.status,
                toMySQLDateTime(record.timestamp),
            ]
        );
    } catch (e) {
        console.error("[AI History] MySQL write failed:", e?.message);
        // Fall through to local JSON backup
    }

    // Always mirror to local JSON (serves as readable dev log)
    const map = await readLocalMap();
    const existing = Array.isArray(map[shopKey]) ? map[shopKey] : [];
    map[shopKey] = [record, ...existing].slice(0, MAX_ENTRIES_PER_SHOP);
    await writeLocalMap(map);

    return record;
}

export async function findAiAgentHistoryEntry(shop, entryId) {
    const shopKey = normalizeShopDomain(shop);
    if (!shopKey || !entryId) return null;

    try {
        const db = getDb();
        const [rows] = await db.execute(
            "SELECT * FROM ai_agent_history WHERE shopDomain = ? AND id = ? LIMIT 1",
            [shopKey, entryId]
        );
        if (rows.length > 0) {
            const r = rows[0];
            return {
                id: r.id,
                prompt: r.prompt || "",
                summary: r.summary || "",
                response: r.response ? (typeof r.response === "string" ? JSON.parse(r.response) : r.response) : null,
                appliedActions: r.appliedActions ? (typeof r.appliedActions === "string" ? JSON.parse(r.appliedActions) : r.appliedActions) : [],
                status: r.status || "applied",
                timestamp: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
            };
        }
    } catch (e) {
        console.warn("[AI History] MySQL lookup failed, trying local JSON:", e?.message);
    }

    // Fallback to local JSON
    const entries = await listAiAgentHistory(shop);
    return entries.find((e) => e.id === entryId) || null;
}
