// Backs the BRIX AI `update_coupon_banner` tool: sets up the product-page
// "Coupon Banner" (app/routes/app.productwidget.jsx) exactly the way that page's
// own Save does — the same two stores (the coupon_slider_widget row via the PHP
// endpoint, and the shared coupon_slider_settings row) — so what the AI sets is
// what the editor shows and what the storefront renders.
//
// The widget PHP endpoint REPLACES its whole row on every POST, so a partial
// change here is always read-merge-write: whatever the caller didn't touch
// (other templates' styles, existing per-coupon styles) is read back and sent
// again unchanged. A brand-new banner is refused until the merchant has chosen
// a template, which coupon(s), and where it shows — the tool returns a
// `needs_info` result telling the model which single thing to ask next.
import { BASE_PHP_URL } from '../utils/api-helpers';
import { getDb } from './db.server';
import { saveCouponSliderSettings } from './cart-config-writes.server';
import { resolveProductByName } from './upsell-rules.server';
import { resolveCollectionByName } from './collection-resolver.server';
import { canPublishFeature } from './plan-permissions.server';
import { localizeCurrencyDeep } from '../utils/currency-text';
import { needsInfo } from '../utils/ai-needs-info';
import {
  COUPON_BANNER_TEMPLATE_DEFAULTS, COUPON_BANNER_TEMPLATES, COUPON_BANNER_PLACEMENTS, couponBannerTemplateKey,
} from '../config/coupon-banner';

const PREFIX = { template1: 'temp1', template2: 'temp2', template3: 'temp3' };
const TEMPLATE_NAMES = Object.fromEntries(Object.values(COUPON_BANNER_TEMPLATES).map((t) => [t.key, t.name]));
const CONDITION_FOR = { products: 'product_handle', collections: 'collection_handle' };

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const asArray = (v) => (Array.isArray(v) ? v : []);

// Quick-reply buttons for each decision (see utils/ai-needs-info.js).
const CHOICES = {
  template: Object.values(COUPON_BANNER_TEMPLATES).map((t) => ({ label: t.name, value: t.name })),
  coupons: [{ label: 'Latest coupon', value: 'Use the latest coupon' }],
  showOn: [
    { label: 'All product pages', value: 'All product pages' },
    { label: 'Specific products', value: 'Specific products' },
    { label: 'Specific collections', value: 'Specific collections' },
  ],
};
const ask = (need, message) => needsInfo(need, message, CHOICES[need]);
async function readWidget(shop) {
  try {
    const res = await fetch(`${BASE_PHP_URL}/save_coupon_slider_widget.php?shopdomain=${encodeURIComponent(shop)}`);
    const json = await res.json();
    return json?.status === 'success' && json.data ? json.data : null;
  } catch { return null; }
}

async function readSettings(shop) {
  const [rows] = await getDb().execute('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  return rows[0] || null;
}

// Newest first, active codes only — the same list the editor page offers.
async function listActiveCoupons(admin) {
  const res = await admin.graphql(`query DiscountList { discountNodes(first: 100, reverse: true) { edges { node { id discount {
    ... on DiscountCodeBasic { title codes(first: 1) { edges { node { code } } } status }
    ... on DiscountCodeBxgy { title codes(first: 1) { edges { node { code } } } status }
    ... on DiscountCodeFreeShipping { title codes(first: 1) { edges { node { code } } } status }
  } } } } }`);
  const json = await res.json();
  return (json.data?.discountNodes?.edges || []).map(({ node }) => {
    const d = node.discount;
    const code = d?.codes?.edges?.[0]?.node?.code || '';
    return code && d.status === 'ACTIVE' ? { id: node.id, code, title: d.title || code } : null;
  }).filter(Boolean);
}

async function resolveHandles(names, resolver, noun) {
  const out = { handles: [], titles: [] };
  for (const raw of asArray(names)) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const r = await resolver(name);
    if (r.status === 'not_found') return { error: { success: false, reason: 'not_found', message: `No ${noun} found matching "${name}". Ask the merchant for the exact name.` } };
    if (r.status === 'ambiguous') return { error: { success: false, reason: 'ambiguous', message: `Multiple ${noun}s match "${name}" — ask the merchant which one they mean.`, candidates: r.candidates.map((c) => c.title) } };
    out.handles.push(r.handle);
    out.titles.push(r.title);
  }
  return out;
}

export async function saveCouponBanner(ctx, args = {}) {
  const { shop, admin, planKey } = ctx;
  const { enabled, layout, placement, couponCodes, latestCouponCount, showOn, productNames, collectionNames } = args;

  const [widget, settings] = await Promise.all([readWidget(shop), readSettings(shop)]);
  const existingIds = asArray(widget?.selectedCouponsGlobal).filter(Boolean);
  const isNew = existingIds.length === 0;
  const requestedKey = couponBannerTemplateKey(args.template);
  if (args.template && !requestedKey) {
    return { success: false, reason: 'invalid_template', message: 'Template must be one of: Classic Banner (classic-banner), Minimal Card (minimal-card), Bold & Vibrant (bold-vibrant).' };
  }
  const wantsCoupons = asArray(couponCodes).some((c) => String(c ?? '').trim()) || Number(latestCouponCount) > 0;

  // A new banner needs three decisions from the merchant. Ask one at a time.
  if (isNew) {
    if (!requestedKey) return ask('template', 'Ask the merchant which template they want: Classic Banner, Minimal Card, or Bold & Vibrant. Then call this tool again.');
    if (!wantsCoupons) return ask('coupons', 'Ask the merchant which coupon(s) the banner should show — a specific discount code, or "the latest coupon(s)". Then call this tool again.');
    if (!showOn) return ask('showOn', 'Ask the merchant where the banner should appear: on all product pages, on specific products, or on specific collections. Then call this tool again.');
  }
  if (showOn === 'products' && !asArray(productNames).some((n) => String(n ?? '').trim())) return ask('showOnTargets', 'Ask the merchant which product(s) the banner should show on.');
  if (showOn === 'collections' && !asArray(collectionNames).some((n) => String(n ?? '').trim())) return ask('showOnTargets', 'Ask the merchant which collection(s) the banner should show on.');

  // Resolve everything against the real store BEFORE writing anything.
  let selected = null; // [{ id, code }]
  if (wantsCoupons) {
    const active = await listActiveCoupons(admin);
    if (active.length === 0) return { success: false, reason: 'no_coupons', message: 'The store has no active discount codes to show. Tell the merchant to create a discount code first (Discount Creator), then try again.' };
    const codes = asArray(couponCodes).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (codes.length) {
      const missing = codes.filter((c) => !active.some((a) => a.code.toLowerCase() === c.toLowerCase()));
      if (missing.length) return { success: false, reason: 'coupon_not_found', message: `No active discount code matches: ${missing.join(', ')}. Ask the merchant which code they mean.`, availableCodes: active.slice(0, 10).map((a) => a.code) };
      selected = codes.map((c) => active.find((a) => a.code.toLowerCase() === c.toLowerCase()));
    } else {
      selected = active.slice(0, Math.min(Math.max(1, Math.floor(Number(latestCouponCount))), 5));
    }
  }

  let targets = { handles: [], titles: [] };
  if (showOn === 'products' || showOn === 'collections') {
    const isProducts = showOn === 'products';
    targets = await resolveHandles(isProducts ? productNames : collectionNames, (n) => (isProducts ? resolveProductByName(admin, n) : resolveCollectionByName(admin, n)), isProducts ? 'product' : 'collection');
    if (targets.error) return targets.error;
  }

  // ── build the widget row (full replace, so carry over what isn't changing) ──
  const activeKey = requestedKey || couponBannerTemplateKey(widget?.selectedTemplate) || 'template1';
  const selectedIds = selected ? selected.map((s) => s.id) : existingIds;
  const codeById = new Map((selected || []).map((s) => [s.id, s.code]));

  const buildTemplate = (key) => {
    const p = PREFIX[key];
    const styles = asObject(widget?.[`${p}DefaultStyle`]);
    const couponStyles = asObject(widget?.[`${p}CouponStyle`]);
    const couponConditions = asArray(widget?.[`${p}CouponCondition`]);
    if (key !== activeKey) {
      return { styles: Object.keys(styles).length ? styles : undefined, couponStyles, couponConditions };
    }
    const nextStyles = Object.keys(styles).length ? styles : localizeCurrencyDeep({ ...COUPON_BANNER_TEMPLATE_DEFAULTS[key], name: undefined }, { symbol: ctx.currencySymbol, code: ctx.currencyCode });
    const nextCouponStyles = {};
    for (const id of selectedIds) {
      nextCouponStyles[id] = { ...asObject(couponStyles[id]), ...(codeById.has(id) ? { couponCode: codeById.get(id) } : {}) };
    }
    let nextConditions;
    if (showOn) {
      nextConditions = showOn === 'all' ? [] : selectedIds.map((id) => ({
        couponId: id,
        displayCondition: CONDITION_FOR[showOn],
        productHandles: showOn === 'products' ? targets.handles : [],
        collectionHandles: showOn === 'collections' ? targets.handles : [],
      }));
    } else {
      nextConditions = couponConditions.filter((c) => c && selectedIds.includes(c.couponId));
    }
    return { styles: nextStyles, couponStyles: nextCouponStyles, couponConditions: nextConditions };
  };

  const payload = {
    shop,
    selectedTemplate: activeKey,
    selectedTemplateCoupon: selectedIds[0] || null,
    selectedCouponsGlobal: selectedIds,
    template1: buildTemplate('template1'),
    template2: buildTemplate('template2'),
    template3: buildTemplate('template3'),
  };

  let widgetSaved = false;
  try {
    const res = await fetch(`${BASE_PHP_URL}/save_coupon_slider_widget.php`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    widgetSaved = (await res.json())?.status === 'success';
  } catch { /* reported below */ }
  if (!widgetSaved) return { success: false, message: 'The Coupon Banner could not be saved right now. Nothing was confirmed — tell the merchant it failed and to try again.' };

  // Shared settings row (on/off, template, placement, layout) — merge-safe save.
  const publishable = canPublishFeature(planKey, 'coupon_lock_pro');
  const nextPlacement = placement && COUPON_BANNER_PLACEMENTS.includes(placement)
    ? placement
    : (COUPON_BANNER_PLACEMENTS.includes(settings?.position) ? settings.position : 'above_cart');
  const savedSettings = await saveCouponSliderSettings(shop, planKey, {
    is_enabled: enabled ?? (isNew ? true : !!settings?.is_enabled),
    selected_template: activeKey,
    position: nextPlacement,
    layout: layout || settings?.layout || 'list',
  });

  // Read-back — only report what the stores actually hold now.
  const after = await readWidget(shop);
  const savedIds = asArray(after?.selectedCouponsGlobal);
  if (!after || couponBannerTemplateKey(after.selectedTemplate) !== activeKey || !selectedIds.every((id) => savedIds.includes(id))) {
    return { success: false, message: 'The Coupon Banner was sent but could not be confirmed when read back. Tell the merchant to check the Coupon Banner page.' };
  }

  const codes = (selected || []).map((s) => s.code);
  const conds = asArray(after[`${PREFIX[activeKey]}CouponCondition`]);
  const cond = conds.find((c) => c?.displayCondition);
  return {
    success: true,
    banner: {
      template: TEMPLATE_NAMES[activeKey],
      coupons: selected ? codes : `${selectedIds.length} existing coupon(s) kept`,
      layout: savedSettings?.layout,
      placement: savedSettings?.position === 'below_cart' ? 'below the Add to Cart button' : 'above the Add to Cart button',
      showOn: cond ? (cond.displayCondition === 'product_handle' ? `specific products: ${(cond.productHandles || []).join(', ')}` : `specific collections: ${(cond.collectionHandles || []).join(', ')}`) : 'all product pages',
      enabled: !!savedSettings?.is_enabled,
    },
    liveOnStorefront: publishable && !!savedSettings?.is_enabled,
    note: publishable ? undefined : 'This plan can design the Coupon Banner but not publish it — it will not show on the storefront until the merchant upgrades. Say this plainly.',
  };
}
