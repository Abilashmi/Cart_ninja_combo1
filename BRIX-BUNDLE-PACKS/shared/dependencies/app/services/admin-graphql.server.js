// Admin API calls for big storefront loads (combo pages with 1000+ products):
// waits and tries again when Shopify says THROTTLED (a 200 reply with an
// error, which the library's own retries don't cover), and runs batches a few
// at a time instead of one after another.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorsOf(error) {
  return error?.body?.errors?.graphQLErrors || error?.body?.errors || error?.response?.errors || [];
}

function isThrottled(errors, error) {
  const list = Array.isArray(errors) ? errors : [errors];
  if (list.some((e) => e?.extensions?.code === 'THROTTLED')) return true;
  return /throttled/i.test(String(error?.message || ''));
}

// How long until the bucket holds what the query asked for (Shopify's
// throttleStatus), else a second.
function waitFor(cost, attempt) {
  const t = cost?.throttleStatus;
  const needed = Number(cost?.requestedQueryCost) - Number(t?.currentlyAvailable);
  const rate = Number(t?.restoreRate);
  const ms = Number.isFinite(needed) && rate > 0 ? Math.ceil((needed / rate) * 1000) + 100 : 1000;
  return Math.min(Math.max(ms, 300), 8000) * (attempt + 1);
}

/** data of one Admin GraphQL query; throws on errors (after THROTTLED retries). */
export async function adminGraphql(admin, query, variables, { tries = 5 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let json;
    try {
      const res = await admin.graphql(query, { variables });
      json = await res.json();
    } catch (error) {
      if (attempt + 1 < tries && isThrottled(errorsOf(error), error)) {
        await sleep(waitFor(error?.body?.extensions?.cost, attempt));
        continue;
      }
      throw error;
    }
    if (json?.errors && (!Array.isArray(json.errors) || json.errors.length)) {
      if (attempt + 1 < tries && isThrottled(json.errors)) {
        await sleep(waitFor(json.extensions?.cost, attempt));
        continue;
      }
      throw new Error(JSON.stringify(json.errors).slice(0, 300));
    }
    return json?.data || {};
  }
}

/** fn over items, at most `limit` at once; results in the items' order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
