import { authenticate } from '../shopify.server';
import { callLlm, parseJsonReply } from '../services/ai-llm.server';

// Real AI-generated upsell suggestions for the admin config screen (Upsell
// Products > AI Recommendations). Scope is deliberately admin-preview-only:
// the merchant reviews these and converts the ones they like into manual
// upsell rules (which already have a working end-to-end storefront path).
// This route does not get called by the storefront.
export async function action({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const catalog = Array.isArray(body.products) ? body.products : [];
  const count = Math.min(Math.max(parseInt(body.count, 10) || 3, 1), 5);

  if (catalog.length < 2) {
    return Response.json(
      { success: false, error: 'Need at least 2 products in your store to generate upsell suggestions.' },
      { status: 400 }
    );
  }

  // Only send what the model needs to reason about — never trust its
  // output for title/price, only for which ids it picked and why.
  const catalogById = new Map(catalog.map((p) => [String(p.id), p]));
  const catalogText = catalog
    .slice(0, 100)
    .map((p) => `- id: "${p.id}", title: "${p.title}", price: ${p.price ?? 'n/a'}`)
    .join('\n');

  const systemPrompt = 'You are a Shopify merchandising expert picking cart upsell products. ' +
    'Only choose product ids that appear in the provided catalog — never invent products. Return ONLY valid JSON.';
  const userPrompt = `Store catalog:\n${catalogText}\n\n` +
    `Pick ${count} products from this catalog that work well as cart-page upsells ` +
    `(complementary items, impulse buys, natural pairings) and a short reason (max 15 words) for each.\n\n` +
    `Return JSON in this exact format: { "suggestions": [{ "id": "<catalog id>", "reason": "..." }] }`;

  const content = await callLlm(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { maxTokens: 400, temperature: 0.7 }
  );

  if (!content) {
    return Response.json(
      { success: false, error: 'AI suggestion generation failed. Please try again.' },
      { status: 502 }
    );
  }

  const parsed = parseJsonReply(content, { suggestions: [] });
  const picks = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  // Resolve against the real catalog so every field shown to the merchant
  // (title/price/image) is genuine store data, not model output.
  const seen = new Set();
  const suggestions = [];
  for (const pick of picks) {
    const id = String(pick?.id ?? '');
    const product = catalogById.get(id);
    if (!product || seen.has(id)) continue;
    seen.add(id);
    suggestions.push({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image || '',
      reason: String(pick.reason || '').slice(0, 150),
    });
    if (suggestions.length >= count) break;
  }

  if (suggestions.length === 0) {
    return Response.json(
      { success: false, error: 'AI could not match any suggestions to your catalog. Please try again.' },
      { status: 502 }
    );
  }

  return Response.json({ success: true, suggestions });
}
