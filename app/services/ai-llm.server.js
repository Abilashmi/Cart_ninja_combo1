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
    // 'native' = real OpenAI function-calling (tools/tool_choice params).
    // 'prompted' = NVIDIA NIM's meta/llama-3.1-8b-instruct — an 8B model
    // reasoning over a ~25-tool registry is exactly the failure mode native
    // tool-calling is worst at, and NIM's OpenAI-compat shim for community
    // checkpoints doesn't reliably forward tool_calls anyway. That path gets
    // a single-tool-per-turn prompted-JSON protocol instead (see
    // requestPromptedToolTurn below) — same spirit as this file's existing
    // extraction-prompt + parseJsonReply pattern, just generalized to
    // "any one tool" instead of one hardcoded extraction shape per route.
    mode: isNvidia ? 'prompted' : 'native',
  };
}

// OpenAI/NVIDIA both return errors as {"error":{"message","type","code"}} —
// pulls the human-readable reason out so callers can surface e.g.
// "You exceeded your current quota" instead of a bare HTTP status. Falls
// back to a short slice of the raw body if it isn't that shape.
function extractProviderErrorMessage(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const msg = parsed?.error?.message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch { /* not JSON */ }
  return bodyText ? bodyText.slice(0, 200) : null;
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
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      // Without this, a stalled provider hangs the calling route
      // indefinitely instead of falling back — every AI feature in the app
      // routes through this one function.
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error('[ai-llm] request failed', err.message);
    return { content: null, finishReason: null, errorStatus: null, errorMessage: err.message };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error('[ai-llm] provider error', res.status, bodyText.slice(0, 300));
    return { content: null, finishReason: null, errorStatus: res.status, errorMessage: extractProviderErrorMessage(bodyText) };
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

// ── Tool-calling (BRIX agent loop) ──────────────────────────────────────────
// tools: array of { name, description, parameters } (parameters is a
// JSON-schema object, same shape OpenAI's function-calling expects). Returns
// { content, toolCalls: [{id, name, args}], finishReason, errorStatus } —
// normalized identically regardless of which provider path served it, so the
// agent loop (api.ai.chat.jsx) never branches on provider.

function toOpenAiTools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function requestLlmWithTools(messages, tools, { apiKey, endpoint, model, maxTokens, temperature }) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, messages, max_tokens: maxTokens, temperature,
        tools: toOpenAiTools(tools), tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.error('[ai-llm] tool-call request failed', err.message);
    return { content: null, toolCalls: [], finishReason: null, errorStatus: null, errorMessage: err.message };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    console.error('[ai-llm] tool-call provider error', res.status, bodyText.slice(0, 300));
    return { content: null, toolCalls: [], finishReason: null, errorStatus: res.status, errorMessage: extractProviderErrorMessage(bodyText) };
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const message = choice?.message || {};
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawToolCalls
    .map((tc) => {
      let args;
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = null; }
      return { id: tc.id, name: tc.function?.name, args };
    })
    // Malformed arguments (or a missing name) never reach the executor —
    // dropped here rather than passed through to run with garbage input.
    .filter((tc) => tc.name && tc.args !== null);

  return { content: message.content ?? null, toolCalls, finishReason: choice?.finish_reason ?? null, errorStatus: null };
}

// Single-tool-per-turn prompted protocol for the 'prompted' provider mode
// (see resolveProvider). Appends a compact tool listing + a strict
// response-shape instruction, then reuses the same raw-JSON extraction
// pattern (parseJsonReply) every other route in this file already relies on.
function buildToolListingText(tools) {
  return (tools || [])
    .map((t) => `- ${t.name}(${Object.keys(t.parameters?.properties || {}).join(', ')}): ${t.description}`)
    .join('\n');
}

async function requestPromptedToolTurn(messages, tools, opts) {
  const instruction = {
    role: 'system',
    content: `You may call ONE of the following tools if the merchant's latest message calls for an action. Available tools:\n${buildToolListingText(tools)}\n\nRespond with EXACTLY one raw JSON object, no markdown fences, no extra text:\n- To call a tool: {"tool":"<tool name>","args":{...}}\n- To just reply conversationally (no action needed): {"reply":"<your reply text>"}`,
  };
  const { content, finishReason, errorStatus, errorMessage } = await requestLlm([...messages, instruction], opts);
  if (content == null) return { content: null, toolCalls: [], finishReason, errorStatus, errorMessage };

  const parsed = parseJsonReply(content, null);
  const validToolNames = new Set((tools || []).map((t) => t.name));
  if (parsed && typeof parsed.tool === 'string' && validToolNames.has(parsed.tool)) {
    return {
      content: null,
      toolCalls: [{
        id: 't-' + Date.now().toString(36),
        name: parsed.tool,
        args: (parsed.args && typeof parsed.args === 'object') ? parsed.args : {},
      }],
      finishReason: 'tool_calls',
      errorStatus: null,
    };
  }
  if (parsed && typeof parsed.reply === 'string') {
    return { content: parsed.reply, toolCalls: [], finishReason: 'stop', errorStatus: null };
  }
  // Parse failure or unrecognized shape — surface the raw text rather than
  // silently dropping the model's reply; the merchant still gets an answer.
  return { content, toolCalls: [], finishReason: 'stop', errorStatus: null };
}

// messages: full [{role, content}] history (system/user/assistant + any
// prior 'tool' role results already appended by the caller's loop).
// tools: the registry from app/config/ai-tool-schemas.js (or a subset).
export async function agentTurn(messages, tools, { maxTokens = 800, temperature = 0.4 } = {}) {
  const { apiKey, endpoint, model, mode } = resolveProvider();
  const opts = { apiKey, endpoint, model, maxTokens, temperature };
  if (mode === 'native') return requestLlmWithTools(messages, tools, opts);
  return requestPromptedToolTurn(messages, tools, opts);
}
