// Bounds an await that would otherwise hang forever.
//
// A try/catch only protects against a call that FAILS — it does nothing for
// one that simply never settles, which is the worse case in a loader or
// action: React Router keeps the fetcher in a non-idle state for as long as
// the request is open, Polaris renders every `loading` button as disabled,
// and the merchant is left with a spinner they cannot click and no error to
// explain it (the FBT page's "Save just loads forever, and clicking it
// sends no request at all" report).
//
// Shopify's admin.graphql client takes no AbortSignal, so this races the
// call rather than cancelling it — the underlying request may still be in
// flight, but the handler returns and the UI unsticks, which is the point.
// Callers pass a fallback so a slow dependency degrades to partial data
// instead of a dead page.
export const TIMED_OUT = Symbol('timed-out');

export function withTimeout(promise, ms, fallback = TIMED_OUT) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
