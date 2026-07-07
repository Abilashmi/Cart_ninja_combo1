import { getDb } from './db.server';

// Escapes a name for use inside a Shopify Admin GraphQL search `query:` string
// (wraps in a title:*...* wildcard match). Strips `"`/`*`/`\` since they're
// wildcard/quote syntax, and `:` since Shopify's query DSL treats it as a
// field:value separator — a colon inside the search value (e.g. a product
// literally titled "The Collection Snowboard: Hydrogen") otherwise breaks the
// query into something far looser than an exact wildcard match, and pulls in
// unrelated products.
function toTitleQuery(name) {
  const cleaned = String(name || '').replace(/["*\\:]/g, '').trim();
  return `title:*${cleaned}*`;
}

// Resolves a free-text product name (as extracted from a merchant's chat
// reply) against the shop's real catalog. Returns exactly one of:
// - { status: 'found', id, title }        — unambiguous match
// - { status: 'not_found' }                — nothing matched
// - { status: 'ambiguous', candidates }    — 2+ matches, caller should ask
export async function resolveProductByName(admin, name) {
  const res = await admin.graphql(
    `query FindProduct($query: String!) {
      products(first: 10, query: $query) {
        edges { node { id title } }
      }
    }`,
    { variables: { query: toTitleQuery(name) } }
  );
  const data = await res.json();
  const matches = (data.data?.products?.edges || []).map(e => ({ id: e.node.id, title: e.node.title }));

  if (matches.length === 0) return { status: 'not_found' };

  // Prefer an exact (case-insensitive) title match over flagging ambiguity —
  // Shopify's search can return loosely-related products (shared prefixes,
  // similar names) even when the merchant named one exactly.
  const exact = matches.find(m => m.title.toLowerCase() === String(name).trim().toLowerCase());
  if (exact) return { status: 'found', id: exact.id, title: exact.title };

  if (matches.length === 1) return { status: 'found', id: matches[0].id, title: matches[0].title };
  return { status: 'ambiguous', candidates: matches.slice(0, 5) };
}

// Resolves a merchant's disambiguation reply ("first one", "the second",
// "2", or the exact/partial title) against a previously-shown candidate
// list. Returns the matched candidate or null if nothing lines up.
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];
export function pickFromCandidates(message, candidates) {
  const lower = String(message || '').toLowerCase().trim();

  for (let i = 0; i < ORDINAL_WORDS.length && i < candidates.length; i++) {
    if (lower.includes(ORDINAL_WORDS[i])) return candidates[i];
  }

  const numMatch = lower.match(/\b([1-9])\b/);
  if (numMatch) {
    const candidate = candidates[parseInt(numMatch[1], 10) - 1];
    if (candidate) return candidate;
  }

  const exact = candidates.find(c => c.title.toLowerCase() === lower);
  if (exact) return exact;

  const contains = candidates.filter(c =>
    lower.includes(c.title.toLowerCase()) || c.title.toLowerCase().includes(lower)
  );
  if (contains.length === 1) return contains[0];

  return null;
}

function parseManualRules(row) {
  if (!row) return [];
  try {
    return row.manual_rules ? JSON.parse(row.manual_rules) : [];
  } catch {
    return [];
  }
}

// Appends one new trigger->offer rule to the shop's existing manual_rules
// array and turns the widget on. Deliberately touches ONLY manual_rules and
// is_enabled — unlike api.upsell-settings.jsx's full-payload upsert, this is
// called from the AI agent with no knowledge of the merchant's title/colors/
// layout, so writing those columns here would clobber them with fallback
// defaults instead of preserving the current values.
export async function appendUpsellRule(shop, { triggerProductId, triggerTitle, offerProductId, offerTitle }) {
  const db = getDb();

  const [rows] = await db.execute(
    'SELECT manual_rules FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  const rules = parseManualRules(rows[0]);

  const newRule = {
    id: `rule-${Date.now()}`,
    triggerProductCount: 1,
    triggerProductIds: [triggerProductId],
    upsellProductCount: 1,
    upsellProductIds: [offerProductId],
  };
  rules.push(newRule);
  const manualRulesJson = JSON.stringify(rules);

  await db.execute(
    `INSERT INTO upsell_widget_settings
       (shop_domain, is_enabled, title, title_color, title_font_weight,
        show_on_empty_cart, layout, button_text, button_bg_color, button_text_color,
        button_border_radius, show_price, position, display_limit, active_template, manual_rules)
     VALUES (?, 1, 'Recommended for you', '#111827', 700, 0, 'grid', 'Add to Cart', '#111827', '#ffffff', 6, 1, 'bottom', 3, 'grid', ?)
     ON DUPLICATE KEY UPDATE
       manual_rules = VALUES(manual_rules),
       is_enabled   = 1,
       updated_at   = CURRENT_TIMESTAMP(3)`,
    [shop, manualRulesJson]
  );

  return { rule: newRule, triggerTitle, offerTitle };
}
