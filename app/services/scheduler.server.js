import cron from "node-cron";
import { reconcileAllShops } from "./analytics-aggregator.server";

// HMR-safe singleton, same idiom as app/db.server.js's global.prismaGlobal —
// prevents duplicate cron jobs from stacking across Vite dev-server reloads.
export function initScheduler() {
  if (global.__analyticsSchedulerStarted) return;
  global.__analyticsSchedulerStarted = true;

  // Light reconciliation: catches recent drift / missed webhooks fast.
  cron.schedule("*/15 * * * *", () => {
    reconcileAllShops({ days: 3 }).catch((err) =>
      console.error("[scheduler] light reconcile failed", err.message)
    );
  });

  // Deep nightly reconciliation: catches late refunds/cancellations.
  cron.schedule("0 3 * * *", () => {
    reconcileAllShops({ days: 35 }).catch((err) =>
      console.error("[scheduler] deep reconcile failed", err.message)
    );
  });

  console.log("[scheduler] analytics reconciliation jobs started");
}
