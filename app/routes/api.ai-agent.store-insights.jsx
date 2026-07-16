import { authenticate } from '../shopify.server';
import { getStoreConfigSnapshot } from '../services/store-config-snapshot.server';
import { getPeriodTotals } from '../services/analytics-query.server';
import { getShopPlan, canAccessFeature } from '../services/plan-permissions.server';
import { getCatalogSnapshot } from '../services/catalog-snapshot.server';

// Order count below this, on any plan, is treated as "not enough order
// history yet" — mirrors MIN_ORDERS_FOR_INSIGHTS in api.analytics.insights.jsx.
const MIN_ORDERS_FOR_ANALYTICS = 3;

// Deliberately templated, not LLM-generated — this reads real store state
// and must never present a fabricated number as fact. No AI credit is
// charged since no LLM call is made.
// Recommendation copy, keyed the same as getStoreConfigSnapshot's fields —
// estimated lift ranges are general industry estimates (same figures used
// in the product spec's own example), not store-specific numbers.
const RECS = [
  { key: 'upsells', title: 'Enable AI Upsells', command: 'Add Upsells', lift: '8-15%' },
  { key: 'progressBar', title: 'Add Free Shipping Progress Bar', command: 'Enable Progress Bar', lift: '10-20%' },
  { key: 'fbt', title: 'Enable Frequently Bought Together', command: 'Enable Frequently Bought Together', lift: '12-18%' },
  { key: 'couponSlider', title: 'Enable Coupon Slider', command: 'Enable Coupon Slider', lift: '5-10%' },
];

const CHECKLIST_LABELS = {
  cartDrawer: 'Cart Drawer', progressBar: 'Progress Bar', upsells: 'AI Upsells',
  fbt: 'Frequently Bought Together', couponSlider: 'Coupon Slider',
};

function monthToDateRange() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    endDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

export async function action({ request }) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    const snapshot = await getStoreConfigSnapshot(shop);

    const checklistLines = Object.entries(CHECKLIST_LABELS).map(
      ([key, label]) => `${snapshot[key] ? '✓' : '✗'} ${label} ${snapshot[key] ? 'Enabled' : 'Disabled'}`
    );

    let aovLine = null;
    let locked = false;
    const planKey = await getShopPlan(shop);
    if (!canAccessFeature(planKey, 'full_analytics')) {
      locked = true;
    } else {
      try {
        const { startDate, endDate } = monthToDateRange();
        const current = await getPeriodTotals(shop, startDate, endDate);
        if (current.order_count >= MIN_ORDERS_FOR_ANALYTICS) {
          aovLine = `Average Order Value: ${current.aov.toFixed(2)} across ${current.order_count} orders this month`;
        }
      } catch (e) {
        console.error('[api.ai-agent.store-insights] analytics query failed:', e.message);
      }
    }

    // No order-history AOV to reason from (locked plan, too few orders, or a
    // query failure) — fall back to reasoning over the live product catalog
    // instead of dead-ending the conversation. Catalog access isn't gated by
    // the analytics plan, so this always works when order data doesn't.
    let catalog = null;
    if (!aovLine) {
      try {
        catalog = await getCatalogSnapshot(admin);
      } catch (e) {
        console.error('[api.ai-agent.store-insights] catalog snapshot failed:', e.message);
      }
    }

    const catalogLines = [];
    if (catalog) {
      const cur = catalog.currencyCode ? `${catalog.currencyCode} ` : '';
      catalogLines.push(`✓ ${catalog.productCount} active products across ${catalog.topVendors.length} vendor${catalog.topVendors.length === 1 ? '' : 's'}`);
      if (catalog.minPrice !== null) {
        catalogLines.push(`✓ Price range: ${cur}${catalog.minPrice.toFixed(2)}–${cur}${catalog.maxPrice.toFixed(2)} (avg ${cur}${catalog.avgPrice.toFixed(2)})`);
      }
      if (catalog.outOfStockCount > 0) {
        catalogLines.push(`⚠ ${catalog.outOfStockCount} product${catalog.outOfStockCount === 1 ? '' : 's'} showing 0 inventory`);
      }
      if (catalog.uncategorizedProductCount > 0) {
        catalogLines.push(`⚠ ${catalog.uncategorizedProductCount} product${catalog.uncategorizedProductCount === 1 ? '' : 's'} not in any collection`);
      }
    }

    const recs = RECS.filter(r => !snapshot[r.key]).slice(0, 3);

    const lines = ['I analyzed your store.', ''];
    if (aovLine) {
      lines.push('Current findings:', `✓ ${aovLine}`, ...checklistLines);
    } else if (catalog) {
      lines.push(
        locked
          ? "Your plan doesn't include order-history analytics, so I looked at your product catalog and current setup instead:"
          : "Your store doesn't have enough order history yet for analytics, so I looked at your product catalog and current setup instead:",
        '',
        'Catalog snapshot:',
        ...catalogLines,
        '',
        'Setup:',
        ...checklistLines,
      );
    } else {
      lines.push(
        "I couldn't load order analytics or catalog data right now, so here's what I can tell from your current setup:",
        '',
        'Current findings:',
        ...checklistLines,
      );
    }

    if (recs.length > 0) {
      lines.push('', 'The biggest opportunities to increase revenue are:');
      recs.forEach((r, i) => lines.push(`${i + 1}. ${r.title} — Estimated lift: ${r.lift}`));
      lines.push('', 'Would you like BRIX to enable one of these?');
    } else {
      lines.push('', 'Every revenue module is already enabled — nice work!');
    }

    const choices = recs.map(r => ({ label: r.title, value: r.command }));

    return Response.json({ status: 'info', message: lines.join('\n'), choices: choices.length ? choices : undefined });
  } catch (e) {
    console.error('[api.ai-agent.store-insights]', e);
    return Response.json({ status: 'error', message: 'Something went wrong analyzing your store. Please try again.' });
  }
}
