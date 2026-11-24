// Memory cache that answers at once: a fresh value is returned as it is, a
// stale one is returned while one background load replaces it, and a missing
// (or too old) one is loaded, every caller waiting on that one load. A load
// that throws stores nothing, so a Shopify hiccup is never cached.

export function createSwrCache({ freshMs, staleMs, max = 500, now = () => Date.now(), label = 'cache' }) {
  const entries = new Map(); // key -> { at, value }
  const loading = new Map(); // key -> Promise

  function load(key, loader) {
    if (loading.has(key)) return loading.get(key);
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        entries.delete(key);
        entries.set(key, { at: now(), value });
        if (entries.size > max) entries.delete(entries.keys().next().value);
        return value;
      })
      .finally(() => loading.delete(key));
    loading.set(key, promise);
    return promise;
  }

  return {
    async get(key, loader) {
      const hit = entries.get(key);
      const age = hit ? now() - hit.at : Infinity;
      if (age < freshMs) return hit.value;
      if (age < staleMs) {
        load(key, loader).catch((error) => console.warn(`[${label}] background refresh failed:`, String(error?.message || error).slice(0, 200)));
        return hit.value;
      }
      return load(key, loader);
    },
    clear() {
      entries.clear();
    },
  };
}
