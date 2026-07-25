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
  { key: 'upsells', name: 'AI Upsells', title: 'Enable AI Upsells', command: 'Add Upsells', lift: '8-15%' },
  { key: 'progressBar', name: 'a Free Shipping Progress Bar', title: 'Add Free Shipping Progress Bar', command: 'Enable Progress Bar', lift: '10-20%' },
  { key: 'fbt', name: 'Frequently Bought Together', title: 'Enable Frequently Bought Together', command: 'Enable Frequently Bought Together', lift: '12-18%' },
  { key: 'couponSlider', name: 'a Coupon Slider', title: 'Enable Coupon Slider', command: 'Enable Coupon Slider', lift: '5-10%' },
];

const CHECKLIST_LABELS = {
  cartDrawer: 'Cart Drawer', progressBar: 'Progress Bar', upsells: 'AI Upsells',
  fbt: 'Frequently Bought Together', couponSlider: 'Coupon Slider',
};

// "a, b, and c" — for folding widget/rec name lists into natural sentences
// instead of a bulleted report.
function humanJoin(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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

    const enabledLabels = Object.entries(CHECKLIST_LABELS).filter(([key]) => snapshot[key]).map(([, label]) => label);
    const disabledLabels = Object.entries(CHECKLIST_LABELS).filter(([key]) => !snapshot[key]).map(([, label]) => label);
    // One sentence describing current setup, in prose — no checklist symbols.
    let setupSentence;
    if (!disabledLabels.length) {
      setupSentence = "Every revenue module you've got is already turned on — nice work.";
    } else if (!enabledLabels.length) {
      setupSentence = `You don't have ${humanJoin(disabledLabels)} turned on yet.`;
    } else {
      setupSentence = `You've already got ${humanJoin(enabledLabels)} live, but ${humanJoin(disabledLabels)} ${disabledLabels.length === 1 ? "isn't" : "aren't"} turned on yet.`;
    }

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
          aovLine = `Your AOV is ${current.aov.toFixed(2)} across ${current.order_count} orders this month.`;
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

    let catalogSentence = null;
    if (catalog) {
      const cur = catalog.currencyCode ? `${catalog.currencyCode} ` : '';
      const vendorPhrase = `${catalog.productCount} active product${catalog.productCount === 1 ? '' : 's'} across ${catalog.topVendors.length} vendor${catalog.topVendors.length === 1 ? '' : 's'}`;
      const pricePhrase = catalog.minPrice !== null
        ? `, priced ${cur}${catalog.minPrice.toFixed(2)}–${cur}${catalog.maxPrice.toFixed(2)} (avg ${cur}${catalog.avgPrice.toFixed(2)})`
        : '';
      const warnings = [];
      if (catalog.outOfStockCount > 0) warnings.push(`${catalog.outOfStockCount} product${catalog.outOfStockCount === 1 ? '' : 's'} showing 0 inventory`);
      if (catalog.uncategorizedProductCount > 0) warnings.push(`${catalog.uncategorizedProductCount} product${catalog.uncategorizedProductCount === 1 ? '' : 's'} not in any collection`);
      const warningPhrase = warnings.length ? ` Heads up — ${humanJoin(warnings)}.` : '';
      catalogSentence = `You've got ${vendorPhrase}${pricePhrase}.${warningPhrase}`;
    }

    const recs = RECS.filter(r => !snapshot[r.key]).slice(0, 3);

    // One bubble reporting what was found, in prose...
    let findings;
    if (aovLine) {
      findings = `${aovLine} ${setupSentence}`;
    } else if (catalog) {
      const intro = locked
        ? "Your plan doesn't include order-history analytics, so I looked at your product catalog instead."
        : "Your store doesn't have enough order history yet for analytics, so I looked at your product catalog instead.";
      findings = `${intro} ${catalogSentence} ${setupSentence}`;
    } else {
      findings = `I couldn't load your order or catalog data just now, but here's your current setup: ${setupSentence}`;
    }

    // ...a second bubble with the recommendation and the follow-up question —
    // the blank line is what MessageRow (BrixAiPage.jsx) splits on to render
    // this as its own chat bubble instead of packing everything into one box.
    const nextStep = recs.length > 0
      ? `The fastest way to lift it: turn on ${humanJoin(recs.map((r) => `${r.name} (+${r.lift})`))}. Want me to enable one?`
      : "Every revenue module is already turned on — nice work!";

    const choices = recs.map(r => ({ label: r.title, value: r.command }));

    return Response.json({ status: 'info', message: `${findings}\n\n${nextStep}`, choices: choices.length ? choices : undefined });
  } catch (e) {
    console.error('[api.ai-agent.store-insights]', e);
    return Response.json({ status: 'error', message: 'Something went wrong analyzing your store. Please try again.' });
  }
}
