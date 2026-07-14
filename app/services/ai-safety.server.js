// Defense-in-depth for the free-form chat path only (api.ai.chat.jsx). That
// path is pure LLM text generation with no backend execution capability —
// the system prompt tells the model never to claim it performed an action
// or promise future work, but prompt compliance on a small model isn't
// guaranteed. This is a cheap backstop: if the reply still contains that
// phrasing, append a corrective note rather than silently trust it.
const COMPLETION_CLAIM_RE = /\bI(?:'ve| have)?\s+(enabled|disabled|turned (on|off)|created|added|configured|updated|applied|fixed|set up|removed|deleted)\b/i;
const FUTURE_PROMISE_RE = /\bI(?:'ll| will)\s+(notify|monitor|watch|keep (an eye|track)|follow up|check back|let you know)\b/i;

export function guardChatReply(text) {
  if (!text) return text;
  if (COMPLETION_CLAIM_RE.test(text) || FUTURE_PROMISE_RE.test(text)) {
    console.warn('[ai-safety] chat reply tripped completion/promise guard:', text.slice(0, 200));
    return `${text}\n\n_(Note: I can only answer questions here — nothing was actually changed. To make this change, send the exact action as its own message, e.g. "Enable Upsells", or use the relevant page in the app.)_`;
  }
  return text;
}
