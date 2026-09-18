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

// BRIX's own text must never contain an emoji — including one that arrived
// by echoing a merchant's saved free-text config value (e.g. a Progress Bar
// completion message the merchant themselves added "🎉" to). The prompt
// alone can't reliably guarantee that (the model composing this reply is
// literally quoting stored data), so this strips emoji from the OUTGOING
// response text only — never the tool result the model reasoned over, never
// anything written back to a database. The merchant's actual saved
// configuration is completely unaffected; only what BRIX says out loud is
// sanitized.
const EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}️‍]/gu;

export function stripEmojis(text) {
  if (!text) return text;
  return text
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
