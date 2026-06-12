import { promises as fs } from "fs";
import path from "path";

const USE_MYSQL = process.env.AI_DB_MYSQL === "true";

let mysqlImpl;
async function getMysql() {
  if (!mysqlImpl) {
    try {
      mysqlImpl = await import("./ai-data-mysql.server.js");
    } catch {
      console.warn("[AI Data] MySQL module not available, falling back to JSON");
      mysqlImpl = null;
    }
  }
  return mysqlImpl;
}

async function tryMysql(fn, fallback) {
  if (USE_MYSQL) {
    try {
      const impl = await getMysql();
      if (impl) return await fn(impl);
    } catch (e) {
      console.warn("[AI Data] MySQL operation failed, falling back to JSON:", e.message);
    }
  }
  return fallback();
}

const DATA_DIR = path.resolve("ai-data");
const CONVERSATIONS_FILE = path.join(DATA_DIR, "conversations.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SUGGESTIONS_FILE = path.join(DATA_DIR, "suggestions.json");
const TOOLS_FILE = path.join(DATA_DIR, "tools.json");
const ACTIONS_FILE = path.join(DATA_DIR, "actions.json");

async function ensureDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch { /* ok */ }
}

async function readJson(file) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeJson(file, data) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ─── Conversations ─── */

export async function listConversations(shopDomain) {
  return tryMysql(
    (m) => m.listConversations(shopDomain),
    async () => {
      const all = await readJson(CONVERSATIONS_FILE);
      return all
        .filter((c) => !shopDomain || c.shopDomain === shopDomain)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
  );
}

export async function createConversation(shopDomain, title) {
  return tryMysql(
    (m) => m.createConversation(shopDomain, title),
    async () => {
      const all = await readJson(CONVERSATIONS_FILE);
      const conv = { id: id(), shopDomain, title: title || "New Chat", createdAt: now(), updatedAt: now() };
      all.push(conv);
      await writeJson(CONVERSATIONS_FILE, all);
      return conv;
    }
  );
}

export async function getConversation(convId) {
  return tryMysql(
    (m) => m.getConversation(convId),
    async () => {
      const all = await readJson(CONVERSATIONS_FILE);
      return all.find((c) => c.id === convId) || null;
    }
  );
}

export async function updateConversation(convId, updates) {
  return tryMysql(
    (m) => m.updateConversation(convId, updates),
    async () => {
      const all = await readJson(CONVERSATIONS_FILE);
      const idx = all.findIndex((c) => c.id === convId);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], ...updates, updatedAt: now() };
      await writeJson(CONVERSATIONS_FILE, all);
      return all[idx];
    }
  );
}

export async function deleteConversation(convId) {
  return tryMysql(
    (m) => m.deleteConversation(convId),
    async () => {
      const all = await readJson(CONVERSATIONS_FILE);
      const filtered = all.filter((c) => c.id !== convId);
      await writeJson(CONVERSATIONS_FILE, filtered);
      const msgs = await readJson(MESSAGES_FILE);
      await writeJson(MESSAGES_FILE, msgs.filter((m) => m.conversationId !== convId));
    }
  );
}

/* ─── Messages ─── */

export async function listMessages(conversationId) {
  return tryMysql(
    (m) => m.listMessages(conversationId),
    async () => {
      const all = await readJson(MESSAGES_FILE);
      return all
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
  );
}

export async function createMessage(conversationId, role, message, extra = {}) {
  return tryMysql(
    (m) => m.createMessage(conversationId, role, message, extra),
    async () => {
      const all = await readJson(MESSAGES_FILE);
      const msg = { id: id(), conversationId, role, message, ...extra, createdAt: now() };
      all.push(msg);
      await writeJson(MESSAGES_FILE, all);
      return msg;
    }
  );
}

/* ─── Suggestions ─── */

export async function getSuggestions(page) {
  return tryMysql(
    (m) => m.getSuggestions(page),
    async () => {
      let all = await readJson(SUGGESTIONS_FILE);
      if (page) all = all.filter((s) => s.page === page && s.active !== false);
      return all.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }
  );
}

export async function seedSuggestions() {
  const existing = await readJson(SUGGESTIONS_FILE);
  if (existing.length > 0) return;
  const defaults = [
    { id: id(), page: "/app", title: "Enable Cart Drawer", prompt: "Enable the cart drawer with modern style", priority: 1, active: true },
    { id: id(), page: "/app", title: "Analyze Revenue", prompt: "Show me my revenue trends", priority: 2, active: true },
    { id: id(), page: "/app", title: "Increase AOV", prompt: "How can I increase my average order value?", priority: 3, active: true },
    { id: id(), page: "/app", title: "Optimize Mobile Layout", prompt: "Optimize my cart for mobile shoppers", priority: 4, active: true },
    { id: id(), page: "/app/cartdrawer", title: "Match My Theme", prompt: "Match the cart drawer to my store theme", priority: 1, active: true },
    { id: id(), page: "/app/cartdrawer", title: "Add Trust Badges", prompt: "Add trust badges to my cart", priority: 2, active: true },
    { id: id(), page: "/app/analytics", title: "Conversion Rate", prompt: "What's my conversion rate this month?", priority: 1, active: true },
    { id: id(), page: "/app/analytics", title: "Cart Abandonment", prompt: "Why are people abandoning cart?", priority: 2, active: true },
    { id: id(), page: "/app/upsell", title: "Enable Upsells", prompt: "Set up upsell recommendations", priority: 1, active: true },
    { id: id(), page: "/app/fbt", title: "Enable FBT", prompt: "Enable Frequently Bought Together", priority: 1, active: true },
  ];
  await writeJson(SUGGESTIONS_FILE, defaults);
}

/* ─── Tools ─── */

export async function getTools() {
  return tryMysql(
    (m) => m.getTools(),
    async () => {
      let all = await readJson(TOOLS_FILE);
      return all.filter((t) => t.active !== false);
    }
  );
}

export async function seedTools() {
  const existing = await readJson(TOOLS_FILE);
  if (existing.length > 0) return;
  const defaults = [
    { id: id(), name: "enable_cart_drawer", description: "Enable the cart drawer with slide-in panel", parameters: "{}", active: true },
    { id: id(), name: "disable_cart_drawer", description: "Disable the cart drawer, revert to default cart", parameters: "{}", active: true },
    { id: id(), name: "enable_upsell", description: "Enable upsell recommendations in cart", parameters: "{}", active: true },
    { id: id(), name: "disable_upsell", description: "Disable upsell recommendations", parameters: "{}", active: true },
    { id: id(), name: "enable_fbt", description: "Enable Frequently Bought Together on product pages", parameters: "{}", active: true },
    { id: id(), name: "disable_fbt", description: "Disable Frequently Bought Together", parameters: "{}", active: true },
    { id: id(), name: "enable_goal_bar", description: "Enable free shipping goal bar in cart", parameters: "{}", active: true },
    { id: id(), name: "disable_goal_bar", description: "Disable free shipping goal bar", parameters: "{}", active: true },
    { id: id(), name: "enable_trust_badges", description: "Enable trust badges near checkout", parameters: "{}", active: true },
    { id: id(), name: "disable_trust_badges", description: "Disable trust badges", parameters: "{}", active: true },
    { id: id(), name: "match_theme", description: "Match cart styling to store theme colors", parameters: "{}", active: true },
    { id: id(), name: "optimize_mobile", description: "Optimize cart for mobile shoppers", parameters: "{}", active: true },
  ];
  await writeJson(TOOLS_FILE, defaults);
}

/* ─── Actions ─── */

export async function createAction({ conversationId, module, actionName, payload, status }) {
  return tryMysql(
    (m) => m.createAction({ conversationId, module, actionName, payload, status }),
    async () => {
      const all = await readJson(ACTIONS_FILE);
      const action = { id: id(), conversationId, module: module || "", actionName, payload: typeof payload === "string" ? payload : JSON.stringify(payload), status: status || "pending", createdAt: now() };
      all.push(action);
      await writeJson(ACTIONS_FILE, all);
      return action;
    }
  );
}
