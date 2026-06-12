const BASE = "/api/ai";

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const aiApi = {
  /* ─── Conversations ─── */
  async getConversations() {
    return request(`${BASE}/conversations`);
  },

  async createConversation(title = "New Chat") {
    return request(`${BASE}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  },

  /* ─── Messages ─── */
  async getMessages(conversationId) {
    return request(`${BASE}/messages?conversationId=${encodeURIComponent(conversationId)}`);
  },

  async saveMessage(conversationId, role, message) {
    return request(`${BASE}/messages`, {
      method: "POST",
      body: JSON.stringify({ conversationId, role, message }),
    });
  },

  /* ─── Suggestions ─── */
  async getSuggestions(page = "") {
    const q = page ? `?page=${encodeURIComponent(page)}` : "";
    return request(`${BASE}/suggestions${q}`);
  },

  /* ─── Tools ─── */
  async getTools() {
    return request(`${BASE}/tools`);
  },

  /* ─── Actions ─── */
  async logAction(data) {
    return request(`${BASE}/actions`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  /* ─── Chat ─── */
  async sendMessage(conversationId, message, messages = []) {
    return request(`${BASE}/chat`, {
      method: "POST",
      body: JSON.stringify({ conversationId, message, messages }),
    });
  },
};
