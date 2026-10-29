// Webhook work that runs after the 200 is sent. Shopify gives a webhook 5 s
// to answer, and every DB statement here is an HTTPS round trip to
// php_backend/db_proxy.php (db.server.js), so an order with a few lines, or
// the first cart webhook after a restart, took longer than that: "No response
// from app" in the Partner Dashboard's webhook logs, then Shopify's retries
// added more load. Handlers verify Shopify's HMAC, hand their work here and
// answer at once. The server is long-running (Fly), so the work isn't cut
// short; a restart mid-task loses that one event (the order rollup is also
// recomputed every 15 min by reconcileDailyRollup).
//
// At most MAX_RUNNING tasks touch the DB at once: the MySQL host is
// connection-limited. Webhooks for one order (create, paid, updated) may run
// side by side; the handlers are safe in any order (countBillableOrder's
// conditional UPDATE, the revenue_counted guard).
const MAX_RUNNING = 4;
const WARN_QUEUE = 1000;

let running = 0;
const queue = [];

export function afterResponse(label, work) {
  queue.push({ label, work });
  if (queue.length === WARN_QUEUE) console.warn(`[webhook-queue] ${WARN_QUEUE} webhook tasks waiting`);
  pump();
}

function pump() {
  while (running < MAX_RUNNING && queue.length > 0) {
    const { label, work } = queue.shift();
    running += 1;
    Promise.resolve()
      .then(work)
      .catch((error) => console.error(`[${label}]`, error?.message || error))
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}
