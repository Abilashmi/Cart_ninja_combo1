import { authenticate } from '../shopify.server';
import { getStoreConfigSnapshot } from '../services/store-config-snapshot.server';
import { getPeriodTotals } from '../services/analytics-query.server';
import { getShopPlan, canAccessFeature } from '../services/plan-permissions.server';

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
    const { session } = await authenticate.admin(request);
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
      const { startDate, endDate } = monthToDateRange();
      const current = await getPeriodTotals(shop, startDate, endDate);
      aovLine = `Average Order Value: ${current.aov.toFixed(2)} across ${current.order_count} orders this month`;
    }

    const recs = RECS.filter(r => !snapshot[r.key]).slice(0, 3);

    const lines = [
      'I analyzed your store.',
      '',
      'Current findings:',
      ...(aovLine ? [`✓ ${aovLine}`] : []),
      ...checklistLines,
    ];
    if (recs.length > 0) {
      lines.push('', 'The biggest opportunities to increase revenue are:');
      recs.forEach((r, i) => lines.push(`${i + 1}. ${r.title} — Estimated lift: ${r.lift}`));
      lines.push('', 'Would you like me to enable one of these?');
    } else {
      lines.push('', 'Every revenue module is already enabled — nice work!');
    }
    if (locked) {
      lines.push('', '(AOV figures need the Starter plan or above — showing feature status only.)');
    }

    const choices = recs.map(r => ({ label: r.title, value: r.command }));

    return Response.json({ status: 'info', message: lines.join('\n'), choices: choices.length ? choices : undefined });
  } catch (e) {
    console.error('[api.ai-agent.store-insights]', e);
    return Response.json({ status: 'error', message: 'Something went wrong analyzing your store. Please try again.' });
  }
}
