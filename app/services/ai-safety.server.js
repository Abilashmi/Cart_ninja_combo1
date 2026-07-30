// Defense-in-depth for BRIX's agent loop (api.ai.chat.jsx). The model can now
// genuinely execute tool calls, so a completion claim ("I've enabled...") is
// no longer inherently false — only checked/guarded here is a promise of
// future/background work, which is never true: nothing happens after this
// reply on its own, there's no scheduler, no "I'll keep monitoring".
const FUTURE_PROMISE_RE = /\bI(?:'ll| will)\s+(notify|monitor|watch|keep (an eye|track)|follow up|check back|let you know)\b/i;

export function guardChatReply(text) {
  if (!text) return text;
  if (FUTURE_PROMISE_RE.test(text)) {
    console.warn('[ai-safety] chat reply tripped future-promise guard:', text.slice(0, 200));
    return `${text}\n\n_(Note: nothing happens automatically after this — if you need something done, just ask me directly.)_`;
  }
  return text;
}
