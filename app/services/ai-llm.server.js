// Shared LLM call helper for all Brix AI routes. Centralizes the provider
// detection convention documented in CLAUDE.md: OPENAI_API_KEY actually
// holds the NVIDIA NIM key (nvapi-...) in this app; anything else is a real
// OpenAI key.
function resolveProvider() {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const isNvidia = apiKey.startsWith('nvapi-');
  return {
    apiKey,
    endpoint: isNvidia
      ? 'https://integrate.api.nvidia.com/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions',
    model: isNvidia ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o-mini',
  };
}

// Strips ```json fences an LLM sometimes wraps its reply in, despite being
// asked for raw JSON, and falls back to a caller-supplied default shape
// (usually {unclear:true}) on any parse failure.
export function parseJsonReply(text, fallback = { unclear: true }) {
  const stripped = String(text || '').replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return fallback;
  }
}

async function requestLlm(messages, { maxTokens = 150, temperature = 0 } = {}) {
  const { apiKey, endpoint, model } = resolveProvider();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error('[ai-llm] provider error', res.status, bodyText.slice(0, 300));
    return { content: null, finishReason: null, errorStatus: res.status };
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  return { content: choice?.message?.content ?? null, finishReason: choice?.finish_reason ?? null, errorStatus: null };
}

// messages: full [{role, content}] array (system/user/assistant) — callers
// build their own prompt shape. Returns the raw assistant text, or null on
// a non-OK response (callers decide the fallback).
export async function callLlm(messages, opts) {
  const { content } = await requestLlm(messages, opts);
  return content;
}

// Like callLlm but also exposes finish_reason (e.g. "length" when the reply
// was cut off by maxTokens) and the HTTP status on failure — used by the
// free-form chat route to auto-continue truncated replies and to surface a
// real error instead of a generic one. Flow-turn routes only ever need the
// raw text, so they keep using callLlm.
export async function callLlmWithMeta(messages, opts) {
  return requestLlm(messages, opts);
}
