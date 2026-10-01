/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useMemo, useRef, useState } from 'react';
import { mergeCustomization } from '../../utils/packs.shared.js';

// The storefront widget registers window.BrixPacksWidget when it runs. It is
// loaded on the client only (it touches the DOM), once per page: first from
// the app's own /packs.js route (app/routes/packs[.]js.jsx serves the same
// file). That works in dev too, where the Shopify CLI proxy answers every
// /extensions/... URL itself, so a bundler import of the extension file 404s
// there. The bundled import is the fallback (production build, test harness).
let widgetLoader = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => (window.BrixPacksWidget ? resolve(window.BrixPacksWidget) : reject(new Error(`${src} did not register the widget`)));
    script.onerror = () => { script.remove(); reject(new Error(`${src} failed to load`)); };
    document.head.appendChild(script);
  });
}
function loadWidget() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.BrixPacksWidget) return Promise.resolve(window.BrixPacksWidget);
  if (!widgetLoader) {
    widgetLoader = loadScript('/packs.js')
      .catch((scriptError) => import('../../../extensions/cart-drawer/assets/packs_widget.js')
        .then(() => window.BrixPacksWidget || Promise.reject(scriptError)))
      .catch((error) => {
        console.error('[BRIX Packs] storefront preview could not load:', error);
        widgetLoader = null; // let the next preview try again
        return null;
      });
  }
  return widgetLoader;
}

/**
 * Admin preview of the storefront Packs widget. It mounts the REAL widget
 * (extensions/cart-drawer/assets/packs_widget.js) with this Pack's data, so
 * every template — pack cards, item slots, option dropdowns, Quick Add "+",
 * selection count, inventory limits — behaves exactly as on the store. Only
 * Add to cart / Buy Now are simulated (they say what they would send).
 *
 * Props:
 *  - template, packType: the Pack's stored template + type (type decides
 *    whether items may differ: Same Variant vs Mix & Match)
 *  - variants: live variants this Pack covers — [{ id, title, price,
 *    availableForSale, maxQuantity?, image?, options?: ['M','Black'] }]
 *  - productOptions: Shopify option names in order (['Size','Color'])
 *  - customization: partial or full customization object (merged over defaults)
 *  - tiers: [{ name, quantity, badge, discountType, discountValue, subtotal, savings, price }]
 *  - productImage, productTitle
 *  - currency: { code, locale } — the shop currency
 *  - demo: preselect a pack size and one item (design thumbnails)
 */
export default function PackPreview({ template, packType, variants, productOptions, customization, tiers, productImage, productTitle, currency, demo = false }) {
  const node = useRef(null);
  const handle = useRef(null);
  const [engine, setEngine] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadWidget().then((loaded) => { if (!cancelled) { setEngine(loaded); setFailed(!loaded); } }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const config = useMemo(() => {
    const list = Array.isArray(variants) ? variants : [];
    const firstTier = (tiers || [])[0];
    const basePrice = list[0]?.price ?? (firstTier && firstTier.quantity ? firstTier.subtotal / firstTier.quantity : 0);
    return {
      currency: { code: currency?.code || 'USD', locale: currency?.locale },
      locale: currency?.locale,
      demo,
      pack: {
        id: 'preview', version: 1, template, packType: packType || (template === 'choose_each_item' ? 'mix_match' : 'same_variant'),
        variantScope: 'all', allowedVariantIds: [], variantId: list[0]?.id || 'preview', variantTitle: list[0]?.title || '',
        productTitle: productTitle || 'Product', productImage: productImage || '', basePrice: Number(basePrice) || 0,
        available: list.length ? list.some((variant) => variant.availableForSale !== false) : true, maxQuantity: list[0]?.maxQuantity ?? null,
        variants: list.map((variant) => ({ ...variant, id: String(variant.id) })), productOptions: productOptions || null,
        tiers: (tiers || []).map((tier) => ({ ...tier })), customization: mergeCustomization(customization),
      },
    };
  }, [template, packType, variants, productOptions, customization, tiers, productImage, productTitle, currency?.code, currency?.locale, demo]);

  // Mount once, then update in place so the merchant's clicks in the preview
  // survive edits to colors, text, etc.
  useEffect(() => {
    if (!engine || !node.current) return;
    if (handle.current) handle.current.update(config);
    else handle.current = engine.mount(node.current, config);
  }, [engine, config]);

  useEffect(() => () => { handle.current?.destroy(); handle.current = null; }, []);

  if (failed) return <div style={{ fontSize: 13, opacity: 0.7 }}>The storefront preview could not be loaded.</div>;
  return (
    <div aria-label="Storefront preview" role="region">
      <div ref={node} />
      {!engine && <div style={{ fontSize: 13, opacity: 0.6, padding: 12 }}>Loading preview…</div>}
    </div>
  );
}
