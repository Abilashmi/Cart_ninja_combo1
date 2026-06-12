const AI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_MODEL = 'gpt-4o-mini';
const AI_API_URL = 'https://api.openai.com/v1/chat/completions';

export async function action({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!AI_API_KEY) {
    return Response.json(
      { success: false, error: 'AI API key not configured on the server.' },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { target } = body;

  try {
    let result;

    if (target === 'title' || target === 'description' || target === 'both') {
      result = await handleTitleDescription(body);
    } else if (target === 'steps') {
      result = await handleSteps(body);
    } else if (target === 'collection_suggest') {
      result = await handleCollectionSuggest(body);
    } else {
      return Response.json({ success: false, error: 'Unknown target.' }, { status: 400 });
    }

    return Response.json({ success: true, data: result });
  } catch (err) {
    console.error('[api.suggestions] Error:', err);
    return Response.json(
      { success: false, error: err.message || 'Unable to generate AI suggestion right now.' },
      { status: 500 }
    );
  }
}

async function callAI(systemPrompt, userPrompt) {
  const res = await fetch(AI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI API error: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('AI returned empty response.');

  return content;
}

async function handleTitleDescription(body) {
  const { target, currentTitle, currentDescription, context } = body;
  const { layout, templateTitle, selectedCollections } = context || {};

  const systemPrompt = `You are a Shopify e-commerce copywriter. Generate compelling, concise product bundle titles and descriptions. Return ONLY valid JSON.`;

  let userPrompt = `Generate `;
  if (target === 'both' || target === 'title') userPrompt += 'a short bundle title (max 8 words)';
  if (target === 'both') userPrompt += ' and ';
  if (target === 'both' || target === 'description') userPrompt += 'a short description (max 25 words)';
  userPrompt += ` for a bundle builder with layout "${layout}"${
    templateTitle ? ` titled "${templateTitle}"` : ''
  }.${
    selectedCollections?.length ? ` Collections: ${selectedCollections.join(', ')}.` : ''
  }${
    currentTitle ? ` Current title: "${currentTitle}".` : ''
  }${
    currentDescription ? ` Current description: "${currentDescription}".` : ''
  }

Return JSON in this format:
${target === 'both' ? `{ "title": "generated title", "description": "generated description" }` :
  target === 'title' ? `{ "title": "generated title" }` :
  `{ "description": "generated description" }`}`;

  const content = await callAI(systemPrompt, userPrompt);

  try {
    const parsed = JSON.parse(content);
    if (target === 'title' && !parsed.title) parsed.title = content.slice(0, 60);
    if (target === 'description' && !parsed.description) parsed.description = content.slice(0, 200);
    if (target === 'both') {
      if (!parsed.title && !parsed.description) {
        const lines = content.split('\n').filter(Boolean);
        parsed.title = lines[0]?.slice(0, 60) || 'Special Bundle';
        parsed.description = lines[1]?.slice(0, 200) || content.slice(0, 200);
      }
    }
    return parsed;
  } catch {
    if (target === 'both') {
      const lines = content.split('\n').filter(Boolean);
      return { title: lines[0]?.slice(0, 60) || 'Special Bundle', description: content.slice(0, 200) };
    }
    if (target === 'title') return { title: content.slice(0, 60) };
    return { description: content.slice(0, 200) };
  }
}

async function handleSteps(body) {
  const { requestedField, steps, context } = body;
  const { layout, templateTitle } = context || {};

  if (!steps?.length) throw new Error('No steps provided.');

  const systemPrompt = `You are a Shopify e-commerce copywriter. Generate compelling step/collection labels for bundle builders. Return ONLY valid JSON.`;

  const stepDesc = steps.map(s =>
    `Step ${s.step}: collection "${s.collectionTitle || s.collectionHandle}"${
      s.currentTitle ? `, current title: "${s.currentTitle}"` : ''
    }${
      s.currentSubtitle ? `, current subtitle: "${s.currentSubtitle}"` : ''
    }`
  ).join('\n');

  const userPrompt = `Generate a ${requestedField === 'title' ? 'short title (max 6 words)' : 'short subtitle (max 8 words)'} for each step.
Layout: "${layout}"${templateTitle ? `, template: "${templateTitle}"` : ''}
Steps:
${stepDesc}

Return JSON format:
{ "steps": [{ "step": 1, "${requestedField}": "generated text" }, ...] }`;

  const content = await callAI(systemPrompt, userPrompt);

  try {
    const parsed = JSON.parse(content);
    if (!parsed.steps?.length) throw new Error('No steps in response.');
    return parsed;
  } catch {
    return { steps: steps.map(s => ({
      step: s.step,
      [requestedField]: content.slice(0, 60),
    })) };
  }
}

async function handleCollectionSuggest(body) {
  const { availableCollections, selectedHandles, templateTitle, layout } = body;

  if (!availableCollections?.length) throw new Error('No collections available.');

  const systemPrompt = `You are a Shopify merchandising expert. Suggest the best collection to add to a bundle builder. Return ONLY valid JSON.`;

  const selected = selectedHandles?.length ? selectedHandles.join(', ') : 'none';
  const cols = availableCollections.map(c => `${c.title} (${c.handle})`).join(', ');

  const userPrompt = `Suggest one collection from the available list that best complements the already-selected collections for this bundle builder.
Layout: "${layout || 'Unknown'}"${templateTitle ? `, template: "${templateTitle}"` : ''}
Already selected: ${selected}
Available: ${cols}

Return JSON format: { "handle": "collection-handle", "title": "Collection Title" }`;

  const content = await callAI(systemPrompt, userPrompt);

  try {
    const parsed = JSON.parse(content);
    const match = availableCollections.find(c =>
      c.handle === parsed.handle || c.title === parsed.title
    );
    if (match) return { handle: match.handle, title: match.title };
    return { handle: availableCollections[0].handle, title: availableCollections[0].title };
  } catch {
    return { handle: availableCollections[0].handle, title: availableCollections[0].title };
  }
}
