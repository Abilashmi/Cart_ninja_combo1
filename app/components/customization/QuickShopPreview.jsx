// Builder preview of the Quick Shop template (layout6). It draws the page
// with the same kit as the storefront (app/utils/combo-quickshop.shared.js:
// buildModel + render, same CSS), so the merchant sees exactly what shoppers
// get. The preview keeps its own cart; clicking a part of the page that
// isn't a button opens that part's settings in the sidebar.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useLoaderData } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { useCurrency } from '../CurrencyContext';
import { createComboWeightCore, normalizeWeightPricing } from '../../utils/combo-weight.shared.js';
import { createQuickShopKit, QUICK_SHOP_CSS } from '../../utils/combo-quickshop.shared.js';
import { codPriceValues, fillPriceTags } from '../../utils/cod.shared';
import { codButtonColors, codButtonType } from '../cod/codButtonLook';

const core = createComboWeightCore();
const kit = createQuickShopKit(core);

const swatch = (label, fill) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" rx="16" fill="${fill}"/><text x="120" y="128" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#475569">${label}</text></svg>`)}`;
const sample = (n, title, { price, compare = null, grams, type, vendor, tags = [], summary, fill, variants }) => ({
  id: `sample-${n}`, title, summary, productType: type, vendor, tags, image: { url: swatch(title.split(' ')[0], fill) },
  variants: variants || [{ id: `sample-${n}-v`, title: 'Default Title', price, compareAtPrice: compare, grams, available: true }],
});
// Shown until the merchant picks collections.
const SAMPLE_PRODUCTS = [
  sample(1, 'Chicken Curry Cut', {
    summary: 'No antibiotics, cleaned and cut', type: 'Chicken', vendor: 'Fresh Farms', tags: ['Bestseller', 'Curry Cut'], fill: '#fde2e2',
    variants: [
      { id: 'sample-1-a', title: '500 g', price: '168.00', compareAtPrice: '179.00', grams: 500, available: true },
      { id: 'sample-1-b', title: '1 kg', price: '320.00', compareAtPrice: '358.00', grams: 1000, available: true },
    ],
  }),
  sample(2, 'Chicken Breast Boneless', { price: '259.00', grams: 450, summary: 'Lean boneless breast pieces', type: 'Chicken', vendor: 'Fresh Farms', tags: ['Boneless'], fill: '#fde8d7' }),
  sample(3, 'Mutton Curry Cut', { price: '449.00', compare: '499.00', grams: 500, summary: 'Tender goat meat, bone-in', type: 'Mutton', vendor: 'Hill Meats', tags: ['Curry Cut'], fill: '#f3e8ff' }),
  sample(4, 'Chicken Drumsticks', { price: '199.00', compare: '229.00', grams: 450, summary: 'Juicy skin-on drumsticks', type: 'Chicken', vendor: 'Hill Meats', tags: ['Drumstick'], fill: '#e0f2fe' }),
];

const toCss = (style) => Object.entries(style).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`).join(';');

// Which settings section each part of the page opens.
const SECTION_OF = [['.bxq-top', 'qsProgress'], ['.bxq-bar', 'qsBar'], ['.bxq-filters', 'qsFilters'], ['.bxq-card', 'qsCards'], ['.bxq-head', 'content']];

export default function QuickShopPreview({ config, device, products = [], collections = [], allStepProducts = {}, onRequestSection = () => {} }) {
  const shopify = useAppBridge();
  const { symbol } = useCurrency();
  const { codEnabled, codComboLook, codPlacement = 'below', codFee = 0 } = useLoaderData() || {};
  const [selection, setSelection] = useState({}); // { [variantId]: { productId, qty } }
  const [pending, setPending] = useState({}); // { [productId]: variantId }
  const [ui, setUi] = useState({ chip: 'all', dd: {}, instock: false, menu: null, sheetOpen: false });
  const lastTier = useRef(null);
  const isMobile = device === 'mobile';

  const handles = useMemo(() => {
    const out = [];
    for (let i = 1; i <= Number(config.tab_count || 1); i++) {
      const h = config[`col_${i}`];
      if (h && !out.includes(h)) out.push(h);
    }
    return out;
  }, [config]);

  const productsByHandle = useMemo(() => {
    const map = {};
    handles.forEach((h) => {
      const fetched = allStepProducts[h];
      map[h] = fetched && fetched.length ? fetched : (products || []).filter((p) => (p.collections || []).some((c) => c.handle === h));
    });
    return map;
  }, [handles, allStepProducts, products]);
  const hasProducts = handles.some((h) => productsByHandle[h]?.length);
  const fallbackProducts = hasProducts ? null : SAMPLE_PRODUCTS;
  const collectionNames = useMemo(() => Object.fromEntries((collections || []).map((c) => [c.handle, c.title])), [collections]);

  const pricing = useMemo(() => {
    const { value } = normalizeWeightPricing(config.weight_pricing);
    // "Only products I choose" by collection can't be checked here (products
    // carry collection handles, not ids), so the preview counts those; the
    // live page and checkout use real membership.
    const qualifies = (productId) => value.qualify.mode !== 'selected'
      || value.qualify.product_ids.includes(productId) || value.qualify.collection_ids.length > 0;
    return {
      view: { measure: value.measure || 'weight', unit: value.unit, tiers: value.tiers, maxGrams: value.max_grams, messages: value.messages, enabled: true },
      qualifies,
    };
  }, [config.weight_pricing]);

  const decimals = core.decimalsFor(null);
  const buildFor = useCallback((sel, extraUi = {}) => kit.buildModel({
    config,
    productsByHandle,
    handles,
    collectionNames,
    fallbackProducts,
    selection: sel,
    pending,
    ui: { ...ui, ...extraUi },
    pricing: pricing.view,
    qualifies: pricing.qualifies,
    symbol,
    decimals,
    isMobile,
  }), [config, productsByHandle, handles, collectionNames, fallbackProducts, pending, ui, pricing, symbol, decimals, isMobile]);

  const model = buildFor(selection);
  const codShown = !!codEnabled && config.show_cod_button !== false;
  model.cod = {
    shown: codShown,
    placement: codPlacement,
    text: fillPriceTags(
      codComboLook?.text || config.cod_btn_text || 'Cash on Delivery',
      codPriceValues(model.totals.finalPrice, codFee),
      (n) => `${symbol}${Number.isInteger(n) ? n : n.toFixed(2)}`,
    ),
    css: codComboLook ? toCss({ ...codButtonColors(codComboLook), ...codButtonType(codComboLook), border: 'none', borderRadius: `${codComboLook.radius}px` }) : '',
  };
  const tierMin = model.box.tier ? model.box.tier.min_grams : null;
  model.bar.celebrate = kit.on(config, 'qs_bar_celebrate') && tierMin !== null && (lastTier.current === null || tierMin > lastTier.current);
  lastTier.current = tierMin;
  const html = kit.render(model);

  // Every product the page can show, by id (for adding).
  const productById = useMemo(() => {
    const map = new Map();
    [...Object.values(productsByHandle).flat(), ...(fallbackProducts || [])].forEach((p) => map.set(String(p.id), p));
    return map;
  }, [productsByHandle, fallbackProducts]);

  const setQty = (variantId, productId, qty) => {
    const next = { ...selection };
    if (qty <= 0) delete next[variantId];
    else next[variantId] = { productId, qty };
    if (qty > (selection[variantId]?.qty || 0) && buildFor(next).box.overMax) {
      const view = pricing.view;
      shopify.toast.show(core.fillMessage(view.messages.over_max, {
        max: view.measure === 'quantity' ? core.formatItems(view.maxGrams) : core.formatWeight(view.maxGrams, view.unit),
      }), { isError: true });
      return;
    }
    setSelection(next);
  };

  const activeVariantId = (product) => {
    const variants = product.variants || [];
    return (variants.find((v) => String(v.id) === String(pending[product.id])) || variants[0])?.id;
  };

  const onClick = (e) => {
    const el = e.target.closest('[data-combo-action]');
    if (!el) {
      for (const [selector, section] of SECTION_OF) {
        if (e.target.closest(selector)) { onRequestSection(section); return; }
      }
      return;
    }
    const action = el.getAttribute('data-combo-action');
    const nextUi = { ...ui, dd: { ...(ui.dd || {}) } };
    if (kit.applyUiAction(nextUi, action, el)) { setUi(nextUi); return; }
    const product = productById.get(String(el.getAttribute('data-product-id')));
    if ((action === 'qty-inc' || action === 'qty-dec') && product) {
      const vid = activeVariantId(product);
      setQty(vid, product.id, (selection[vid]?.qty || 0) + (action === 'qty-inc' ? 1 : -1));
      return;
    }
    if (action === 'box-inc' || action === 'box-dec') {
      const vid = el.getAttribute('data-variant-id');
      const sel = Object.entries(selection).find(([k]) => String(k) === String(vid));
      if (sel) setQty(sel[0], sel[1].productId, sel[1].qty + (action === 'box-inc' ? 1 : -1));
      return;
    }
    if (action === 'reset') { setSelection({}); setUi({ ...ui, sheetOpen: false }); return; }
    if (action === 'checkout' || action === 'cod') shopify.toast.show('Checkout works on your live combo page.');
  };

  const onChange = (e) => {
    const el = e.target.closest('[data-combo-action="variant-select"]');
    if (el) setPending((prev) => ({ ...prev, [el.getAttribute('data-product-id')]: el.value }));
  };

  return (
    <div style={{ background: '#eef1f5', padding: isMobile ? 0 : 12, minHeight: '100%' }}>
      <style>{QUICK_SHOP_CSS}</style>
      {!hasProducts && (
        <div style={{ background: '#fff7ed', color: '#9a3412', fontSize: 13, padding: '8px 12px', borderRadius: 8, margin: isMobile ? 8 : '0 0 10px' }}>
          Sample products. Choose collections under Layout → Shop Collections to see yours.
        </div>
      )}
      {/* The kit escapes every text it puts in the HTML. */}
      <div role="presentation" onClick={onClick} onChange={onChange} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
