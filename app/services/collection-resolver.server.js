// Resolves a free-text collection name (as extracted from a merchant's chat
// reply) against the shop's real catalog. Same shape/behavior as
// resolveProductByName in upsell-rules.server.js, applied to collections
// instead of products.
function toTitleQuery(name) {
  const cleaned = String(name || '').replace(/["*\\:]/g, '').trim();
  return `title:*${cleaned}*`;
}

// Returns exactly one of:
// - { status: 'found', id, title, handle }  — unambiguous match
// - { status: 'not_found' }                  — nothing matched
// - { status: 'ambiguous', candidates }      — 2+ matches, caller should ask
export async function resolveCollectionByName(admin, name) {
  const res = await admin.graphql(
    `query FindCollection($query: String!) {
      collections(first: 10, query: $query) {
        edges { node { id title handle } }
      }
    }`,
    { variables: { query: toTitleQuery(name) } }
  );
  const data = await res.json();
  const matches = (data.data?.collections?.edges || []).map(e => ({
    id: e.node.id, title: e.node.title, handle: e.node.handle,
  }));

  if (matches.length === 0) return { status: 'not_found' };

  const exact = matches.find(m => m.title.toLowerCase() === String(name).trim().toLowerCase());
  if (exact) return { status: 'found', id: exact.id, title: exact.title, handle: exact.handle };

  if (matches.length === 1) return { status: 'found', id: matches[0].id, title: matches[0].title, handle: matches[0].handle };
  return { status: 'ambiguous', candidates: matches.slice(0, 5) };
}
