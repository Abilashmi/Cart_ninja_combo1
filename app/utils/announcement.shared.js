// Rotating announcement bar rules shared by the Cart Editor (state, sidebar,
// preview). The storefront (cart_drawer_inline.js parseAnnouncementData)
// mirrors messagesFromConfig, since it can't import this.
export const ANNOUNCEMENT_MAX_MESSAGES = 10;
export const ANNOUNCEMENT_INTERVAL_MIN = 2;
export const ANNOUNCEMENT_INTERVAL_MAX = 15;

/** The messages to show: non-empty strings, at most ANNOUNCEMENT_MAX_MESSAGES. */
export function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .map((m) => String(m ?? '').trim())
    .filter(Boolean)
    .slice(0, ANNOUNCEMENT_MAX_MESSAGES);
}

/**
 * Messages from stored values: the announcement_messages JSON array when it
 * has any, else the single announcement_text (every bar saved before
 * rotation existed).
 */
export function messagesFromConfig(rawMessages, text) {
  let list = rawMessages;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  const clean = cleanMessages(list);
  if (clean.length) return clean;
  const single = String(text ?? '').trim();
  return single ? [single] : [];
}

/** The editor state's messages (falls back to `text`). */
export function announcementMessages(ann) {
  return messagesFromConfig(ann?.messages, ann?.text);
}

export function clampInterval(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 4;
  return Math.max(ANNOUNCEMENT_INTERVAL_MIN, Math.min(ANNOUNCEMENT_INTERVAL_MAX, n));
}
