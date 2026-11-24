// Which of a combo page's products are in each collection of the box
// templates' collection filter groups (qs_filter_groups, see
// app/utils/combo-quickshop.shared.js filterGroups). Filter collections can
// be any store collection, not only the page's own, so instead of loading
// their products this asks Shopify Product.inCollection for the products the
// page already shows: one query for the collections' ids, then one per 100
// products. Never throws: a failure leaves the handle out, and the page then
// shows that option without filtering by it.
import { adminGraphql, mapLimit } from './admin-graphql.server';

const MAX_HANDLES = 75; // 5 groups × 15 collections
// Box pages load every product of their collections (1000+ books on one page).
const MAX_PRODUCTS = 5000;
const HANDLES_PER_QUERY = 25;
// Keep each query small: products × collections fields per request.
const FIELDS_PER_QUERY = 2500;

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

function unique(list, test, max) {
  const out = [];
  for (const v of list || []) {
    if (typeof v === 'string' && test(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

const run = (admin, query, variables) => adminGraphql(admin, query, variables);

/** { [handle]: collection gid } for the handles that exist. */
async function collectionIds(admin, handles) {
  const out = {};
  for (let start = 0; start < handles.length; start += HANDLES_PER_QUERY) {
    const chunk = handles.slice(start, start + HANDLES_PER_QUERY);
    const vars = chunk.map((_, i) => `$h${i}: String!`).join(', ');
    const fields = chunk.map((_, i) => `c${i}: collectionByIdentifier(identifier: { handle: $h${i} }) { id }`).join('\n');
    const variables = Object.fromEntries(chunk.map((h, i) => [`h${i}`, h]));
    const data = await run(admin, `query BrixFilterCollections(${vars}) {\n${fields}\n}`, variables);
    chunk.forEach((h, i) => { if (data[`c${i}`]?.id) out[h] = data[`c${i}`].id; });
  }
  return out;
}

/**
 * { [handle]: [productId] }: for each handle, the given products that are in
 * that collection. A handle with no such collection gets [] (its option is
 * hidden); a handle whose lookup failed is left out.
 */
export async function loadCollectionMembers(admin, { handles, productIds }) {
  const wanted = unique(handles, (h) => /^[^\s"'<>&\\]{1,255}$/.test(h), MAX_HANDLES);
  const ids = unique(productIds, (id) => PRODUCT_GID.test(id), MAX_PRODUCTS);
  if (!wanted.length) return {};

  let byHandle;
  try {
    byHandle = await collectionIds(admin, wanted);
  } catch (e) {
    console.error('[collection-members] collection lookup failed:', e.message);
    return {};
  }

  const members = {};
  wanted.forEach((h) => { if (!byHandle[h]) members[h] = []; });
  const found = wanted.filter((h) => byHandle[h]);
  if (!found.length) return members;
  if (!ids.length) {
    found.forEach((h) => { members[h] = []; });
    return members;
  }

  const perQuery = Math.max(10, Math.min(100, Math.floor(FIELDS_PER_QUERY / found.length)));
  const vars = ['$ids: [ID!]!', ...found.map((_, i) => `$c${i}: ID!`)].join(', ');
  const fields = found.map((_, i) => `m${i}: inCollection(id: $c${i})`).join('\n');
  const query = `query BrixFilterMembers(${vars}) {\n  nodes(ids: $ids) {\n    ... on Product {\n      id\n${fields}\n    }\n  }\n}`;
  const collected = Object.fromEntries(found.map((h) => [h, []]));
  const batches = [];
  for (let start = 0; start < ids.length; start += perQuery) batches.push(ids.slice(start, start + perQuery));
  try {
    // A few at a time; results kept in page order.
    const pages = await mapLimit(batches, 3, (batch) => {
      const variables = { ids: batch };
      found.forEach((h, i) => { variables[`c${i}`] = byHandle[h]; });
      return run(admin, query, variables);
    });
    for (const data of pages) {
      for (const node of data.nodes || []) {
        if (!node?.id) continue;
        found.forEach((h, i) => { if (node[`m${i}`] === true) collected[h].push(node.id); });
      }
    }
  } catch (e) {
    console.error('[collection-members] membership query failed:', e.message);
    return members;
  }
  return { ...members, ...collected };
}
