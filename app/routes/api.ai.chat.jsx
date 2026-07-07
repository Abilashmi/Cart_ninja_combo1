import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';

const SYSTEM_PROMPT = `You are Brix AI, a helpful assistant for Shopify merchants using the Brix cart drawer app.
You help merchants optimise their cart drawer, upsell products, set up coupon banners, and understand analytics.
Keep responses concise and actionable. When a merchant asks you to enable or configure a feature,
acknowledge the request and confirm what you are doing. Limit responses to 3-4 sentences.`;

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const { message, messages: history = [] } = await request.json();
    if (!message) return Response.json({ success: false, error: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(session.shop, admin);

    const apiKey = process.env.OPENAI_API_KEY || '';
    const isNvidia = apiKey.startsWith('nvapi-');
    const endpoint = isNvidia
      ? 'https://integrate.api.nvidia.com/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = isNvidia ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o-mini';

    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6).map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text })),
      { role: 'user', content: message },
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: chatMessages, max_tokens: 200, temperature: 0.7 }),
    });

    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    if (!res.ok) {
      const err = await res.text();
      console.error('[api.ai.chat] AI error:', err);
      return Response.json({ success: true, message: 'I\'m here to help! Try commands like "Enable upsells" or "Show progress bar".', credits });
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'I\'m not sure how to help with that. Try a specific action like "Enable Cart Drawer".';
    return Response.json({ success: true, message: text, credits });
  } catch (e) {
    console.error('[api.ai.chat]', e);
    return Response.json({ success: true, message: 'Something went wrong. Please try again.' });
  }
}
