import { useState, useCallback, useEffect, useRef } from 'react';
import { useLoaderData, useRouteError, useFetcher } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button,
  Select, Checkbox, Divider, RadioButton, Collapsible,
  Icon, Modal, TextField, Toast, Frame, Banner,
} from '@shopify/polaris';
import BrixBar from '../components/ai-agent/BrixBar';
import { SliderField } from '../components/shared/SliderField';
import {
  SettingsIcon, MagicIcon, ColorIcon, ChevronDownIcon, ChevronUpIcon, ProductIcon,
  CheckCircleIcon, TargetIcon, PlayIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { ProBadge } from '../components/plan/PlanGate';
import { usePlan } from '../components/PlanContext';
import { useCurrency } from '../components/CurrencyContext';
import ProductPickerBody from '../components/shared/ProductPickerBody';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// fbt_rules.trigger_scope is a real enforced MySQL enum
// ('all'|'specific_products'|'specific_collections') — the UI's own
// displayScope value ('all'|'per_product') isn't a member, so writing it
// directly was being silently coerced to '' by MySQL. This only maps the
// trigger_scope COLUMN value; fbt_widget.condition still stores the raw
// displayScope ('per_product') unchanged, since that's the format the
// storefront renderer and this same loader already expect.
function toTriggerScopeEnum(displayScope) {
  if (displayScope === 'per_product') return 'specific_products';
  if (displayScope === 'all') return 'all';
  return displayScope || 'all';
}

/* ─── LOADER ──────────────────────────────────────────────────────────────── */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Products (Admin GraphQL), FBT config (MySQL), and theme-embed detection
  // (2 sequential Shopify REST calls) are all independent of each other, so
  // they run concurrently instead of one after another. Each keeps its own
  // try/catch so a failure in one doesn't affect the others' results.
  const [allProducts, { fbtConfig, manualRules }, fbtEmbedEnabled] = await Promise.all([
    /* fetch products from Shopify */
    (async () => {
      try {
        const prodRes = await admin.graphql(`
          query getProducts {
            products(first: 50) {
              edges {
                node {
                  id
                  title
                  handle
                  featuredImage { url }
                  variants(first: 1) {
                    edges {
                      node { id price }
                    }
                  }
                }
              }
            }
          }
        `);
        const prodData = await prodRes.json();
        return (prodData?.data?.products?.edges || []).map(e => ({
          id: e.node.id,
          title: e.node.title,
          handle: e.node.handle,
          image: e.node.featuredImage?.url || '',
          price: e.node.variants?.edges?.[0]?.node?.price || '0',
        }));
      } catch (e) {
        console.error('[FBT loader] products:', e);
        return [];
      }
    })(),
    /* fetch FBT config from new normalized tables */
    (async () => {
      let fbtConfig = null;
      let manualRules = [];
      try {
        const db = getDb();
        const [settings] = await db.execute(
          'SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
        );
        const [rules] = await db.execute(
          'SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]
        );
        if (settings.length > 0) {
          const s = settings[0];
          fbtConfig = {
            is_enabled: s.is_enabled,
            activeTemplate: s.selected_template || 'fbt1',
            mode: s.mode || 'manual',
            layout: s.layout || 'horizontal',
            interactionType: s.interaction_type || 'classic',
            showPrices: s.show_prices !== 0,
            showAddAllButton: s.show_add_all_button !== 0,
            bgColor: s.bg_color || '#ffffff',
            textColor: s.text_color || '#111827',
            priceColor: s.price_color || '#059669',
            buttonColor: s.button_color || '#111827',
            buttonTextColor: s.button_text_color || '#ffffff',
            borderColor: s.border_color || '#e5e7eb',
            borderRadius: s.border_radius ?? 8,
            aiEnabled: s.mode === 'ai',
            aiProductCount: s.ai_product_count || 3,
            widgetPlacement: s.widget_placement || 'above_cart',
          };
          manualRules = rules.map(r => ({
            id: r.id,
            name: r.name,
            displayScope: r.trigger_scope || 'all',
            triggerProducts: parseJson(r.trigger_products, []),
            triggerCollections: parseJson(r.trigger_collections, []),
            fbtProducts: parseJson(r.fbt_products, []),
          }));
        } else {
          // Fall back to legacy fbt_widget table
          const [legacy] = await db.execute('SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]);
          if (legacy.length > 0) {
            const row = legacy[0];
            const tpl = parseJson(row.temp1, {});
            fbtConfig = {
              is_enabled: 1,
              activeTemplate: row.selectedTemp || 'fbt1',
              mode: row.selectedMode || 'manual',
              layout: tpl.layout || 'horizontal',
              interactionType: tpl.interactionType || 'classic',
              showPrices: tpl.showPrices !== false,
              showAddAllButton: tpl.showAddAllButton !== false,
              bgColor: tpl.bgColor || '#ffffff',
              textColor: tpl.textColor || '#111827',
              priceColor: tpl.priceColor || '#059669',
              buttonColor: tpl.buttonColor || '#111827',
              buttonTextColor: tpl.buttonTextColor || '#ffffff',
              borderColor: tpl.borderColor || '#e5e7eb',
              borderRadius: tpl.borderRadius ?? 8,
              aiEnabled: row.ai_enabled === 1,
              aiProductCount: row.ai_product_count || 3,
              widgetPlacement: tpl.widgetPlacement || 'above_cart',
            };
            manualRules = parseJson(row.condition, []);
          }
        }
      } catch (e) {
        console.error('[FBT loader] DB read:', e.message);
      }
      return { fbtConfig, manualRules };
    })(),
    // Detect if FBT app embed is enabled in the active theme.
    // Optimistic default: if we CANNOT read the theme (missing read_themes scope,
    // API error, etc.) we assume it's enabled so we never show a false warning.
    // We only downgrade to "disabled" when we successfully parse the theme and
    // confirm no enabled FBT app-embed block exists.
    (async () => {
      try {
        const themesRes = await fetch(
          `https://${shop}/admin/api/2024-04/themes.json?role=main`,
          { headers: { 'X-Shopify-Access-Token': session.accessToken } }
        );
        if (themesRes.ok) {
          const { themes } = await themesRes.json();
          const mainTheme = (themes || []).find(t => t.role === 'main') || themes?.[0];
          if (mainTheme) {
            const assetRes = await fetch(
              `https://${shop}/admin/api/2024-04/themes/${mainTheme.id}/assets.json?asset[key]=config/settings_data.json`,
              { headers: { 'X-Shopify-Access-Token': session.accessToken } }
            );
            if (assetRes.ok) {
              const { asset } = await assetRes.json();
              const settingsData = JSON.parse(asset?.value || '{}');
              const current = settingsData?.current || {};
              // Scan all sections + top-level app-embed blocks (theme structure varies)
              const allBlocks = [];
              Object.values(current.sections || {}).forEach(s => Object.values(s?.blocks || {}).forEach(b => allBlocks.push(b)));
              Object.values(current.blocks || {}).forEach(b => allBlocks.push(b));
              return allBlocks.some(b => {
                if (b.disabled) return false;
                return (b.type || '').toLowerCase().includes('fbt');
              });
            }
          }
        }
      } catch { /* keep optimistic true on any error */ }
      return true;
    })(),
  ]);

  return {
    shop,
    allProducts,
    manualRules,
    fbtEmbedEnabled,
    // Surfaces the null-check the query above already does — `fbtConfig` is
    // only non-null once a real row was found in fbt_widget_settings/legacy
    // fbt_widget. Needed because the object returned below always has a
    // full set of fallback values either way, so the client can't otherwise
    // tell "never saved anything" apart from "saved, happens to match
    // defaults" — the setup tour needs exactly that distinction.
    hasSavedFbtConfig: fbtConfig !== null,
    fbtConfig: fbtConfig ?? {
      is_enabled: 1,
      activeTemplate: 'fbt1', mode: 'manual', layout: 'horizontal',
      interactionType: 'classic', showPrices: true, showAddAllButton: true,
      bgColor: '#ffffff', textColor: '#111827', priceColor: '#059669',
      buttonColor: '#111827', buttonTextColor: '#ffffff', borderColor: '#e5e7eb',
      borderRadius: 8, aiEnabled: false, aiProductCount: 3, widgetPlacement: 'above_cart',
    },
  };
};

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  try {
    const templates = body.templates || {};
    const manualRules = body.manualRules || [];
    const aiEnabled = body.aiEnabled ? 1 : 0;
    const aiProductCount = body.aiProductCount != null ? Number(body.aiProductCount) : 3;
    const selectedTemplate = body.selectedTemplate || 'fbt1';
    const mode = body.mode || (aiEnabled ? 'ai' : 'manual');
    const activeTpl = templates[selectedTemplate] || Object.values(templates)[0] || {};
    const widgetPlacement = body.widgetPlacement || 'above_cart';
    // Backend enforcement (defense-in-depth): FBT is 'preview' on Free — the
    // admin UI already locks the enable toggle off, but a Free shop could
    // also POST directly here. The storefront-facing GET in
    // save_fbt_widget.php already forces isEnabled off too, but keep the
    // saved row itself truthful.
    const planKey = await getShopPlan(shop);
    const fbtPublishable = canPublishFeature(planKey, 'fbt');
    const isEnabled = fbtPublishable && body.isEnabled !== false ? 1 : 0;

    const db = getDb();

    // Save to normalized fbt_widget_settings table
    await db.execute(`
      INSERT INTO fbt_widget_settings
        (shop_domain, is_enabled, selected_template, mode, ai_product_count,
         bg_color, text_color, price_color, button_color, button_text_color,
         border_color, border_radius, layout, interaction_type, show_prices, show_add_all_button,
         widget_placement)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        is_enabled = VALUES(is_enabled),
        selected_template   = VALUES(selected_template),
        mode                = VALUES(mode),
        ai_product_count    = VALUES(ai_product_count),
        bg_color            = VALUES(bg_color),
        text_color          = VALUES(text_color),
        price_color         = VALUES(price_color),
        button_color        = VALUES(button_color),
        button_text_color   = VALUES(button_text_color),
        border_color        = VALUES(border_color),
        border_radius       = VALUES(border_radius),
        layout              = VALUES(layout),
        interaction_type    = VALUES(interaction_type),
        show_prices         = VALUES(show_prices),
        show_add_all_button = VALUES(show_add_all_button),
        widget_placement    = VALUES(widget_placement),
        updated_at          = CURRENT_TIMESTAMP(3)
    `, [
      shop, isEnabled, selectedTemplate, mode, aiProductCount,
      activeTpl.bgColor || '#ffffff',
      activeTpl.textColor || '#111827',
      activeTpl.priceColor || '#059669',
      activeTpl.buttonColor || '#111827',
      activeTpl.buttonTextColor || '#ffffff',
      activeTpl.borderColor || '#e5e7eb',
      activeTpl.borderRadius ?? 8,
      activeTpl.layout || 'horizontal',
      activeTpl.interactionType || 'classic',
      activeTpl.showPrices !== false ? 1 : 0,
      activeTpl.showAddAllButton !== false ? 1 : 0,
      widgetPlacement,
    ]);

    // Replace manual rules in fbt_rules table
    await db.execute('DELETE FROM fbt_rules WHERE shop_domain = ?', [shop]);
    for (let i = 0; i < manualRules.length; i++) {
      const r = manualRules[i];
      await db.execute(`
        INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, is_active, sort_order)
        VALUES (?,?,?,?,?,?,1,?)
      `, [
        shop,
        r.name || `Rule ${i + 1}`,
        toTriggerScopeEnum(r.displayScope || r.trigger_scope),
        r.triggerProducts?.length ? JSON.stringify(r.triggerProducts) : null,
        r.triggerCollections?.length ? JSON.stringify(r.triggerCollections) : null,
        r.fbtProducts?.length ? JSON.stringify(r.fbtProducts) : null,
        i,
      ]);
    }

    // Also write to legacy fbt_widget (storefront-facing), with placement embedded in each template
    await db.execute(`
      INSERT INTO fbt_widget (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\`, ai_enabled, ai_product_count, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        temp1=VALUES(temp1),temp2=VALUES(temp2),temp3=VALUES(temp3),
        selectedTemp=VALUES(selectedTemp),selectedMode=VALUES(selectedMode),
        \`condition\`=VALUES(\`condition\`),ai_enabled=VALUES(ai_enabled),
        ai_product_count=VALUES(ai_product_count),updated_at=CURRENT_TIMESTAMP(3)
    `, [
      shop,
      templates.fbt1 ? JSON.stringify({ ...templates.fbt1, widgetPlacement }) : null,
      templates.fbt2 ? JSON.stringify({ ...templates.fbt2, widgetPlacement }) : null,
      templates.fbt3 ? JSON.stringify({ ...templates.fbt3, widgetPlacement }) : null,
      selectedTemplate, mode, JSON.stringify(manualRules), aiEnabled, aiProductCount,
    ]);

    return { success: true };
  } catch (e) {
    console.error('[FBT action] DB write:', e.message);
    return { success: false, error: e.message };
  }
};

/* ─── CONSTANTS ───────────────────────────────────────────────────────────── */
const TEMPLATES = [
  { id: 'classic-grid', name: 'Classic Grid',   apiKey: 'fbt1', colors: { bg: '#ffffff', text: '#111827', price: '#059669', button: '#111827', buttonText: '#ffffff', border: '#e5e7eb' }, borderRadius: 8  },
  { id: 'modern-cards', name: 'Modern Cards',   apiKey: 'fbt2', colors: { bg: '#f9fafb', text: '#374151', price: '#dc2626', button: '#4f46e5', buttonText: '#ffffff', border: '#d1d5db' }, borderRadius: 12 },
  { id: 'vertical-list',name: 'Vertical List',  apiKey: 'fbt3', colors: { bg: '#ffffff', text: '#111827', price: '#dc2626', button: '#111827', buttonText: '#ffffff', border: '#e5e7eb' }, borderRadius: 4  },
];

const INTERACTION_OPTIONS = [
  { label: 'Classic — Individual Add / Remove',     value: 'classic'      },
  { label: 'Quick Add — Quantity Stepper',          value: 'quick-add'    },
  { label: 'Bundle — Minimum 1 Required',           value: 'bundle'       },
  { label: 'Checkbox + Quantity — Select & adjust', value: 'checkbox-qty' },
];

const LAYOUT_OPTIONS = [
  { label: 'Carousel — Horizontal scroll', value: 'carousel' },
  { label: 'Grid — 2-column grid',         value: 'grid'     },
  { label: 'Vertical — Stacked list',      value: 'vertical' },
];

const PLACEMENT_OPTIONS = [
  { value: 'all',      label: 'Show on all product pages',                    helpText: 'The same FBT products will appear on every product page'              },
  { value: 'specific', label: 'Show on a specific product page',              helpText: 'Select one product page where FBT will appear'                         },
  { value: 'different',label: 'Show different FBT for different product pages',helpText: 'Create multiple rules with different FBT products per page'            },
];

const PREVIEW_SLOT_COUNT = 3;

const SECTION_TIPS = {
  interaction: 'Offering "Add All to Cart" in a single click increases bundle conversion by up to 37% — lower friction means more customers complete the bundle.',
  colors:      'Matching your FBT widget colors to your brand palette boosts trust — 71% of consumers expect a consistent visual experience across all touchpoints.',
  styling:     'Larger product images in FBT widgets increase click-through by 23% — shoppers are 60% more likely to add a product they can clearly see.',
};

const defaultProductStates = () => Array.from({ length: PREVIEW_SLOT_COUNT }, () => ({ added: true, qty: 1, checked: true }));

// Style/layout preview must show the merchant's real store products, never
// generic placeholder names — prefers the first rule's actual FBT picks
// (already full product objects, not just IDs) and fills any remaining
// slots from the real catalog so a merchant with no rules yet still sees
// their own products instead of fake ones.
function buildPreviewProducts(rules, catalog) {
  const ruleProducts = (rules || []).find(r => (r.fbtProducts || []).length > 0)?.fbtProducts || [];
  const seen = new Set();
  const unique = [...ruleProducts, ...(catalog || [])].filter((p) => {
    if (!p?.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return Array.from({ length: PREVIEW_SLOT_COUNT }, (_, i) => {
    const p = unique[i];
    return p
      ? { id: p.id, name: p.title || p.name || `Product ${i + 1}`, price: Number(p.price || 0), image: p.image || '' }
      : { id: `placeholder-${i}`, name: 'Add a product', price: 0, image: '' };
  });
}

function apiKeyToTemplateId(apiKey) {
  return TEMPLATES.find(t => t.apiKey === apiKey)?.id ?? 'classic-grid';
}
function templateIdToApiKey(id) {
  return TEMPLATES.find(t => t.id === id)?.apiKey ?? 'fbt1';
}

/* ─── PRODUCT PICKER MODAL ────────────────────────────────────────────────── */
function ProductPickerModal({ open, onClose, allProducts, selectedIds, onSave, title }) {
  const { symbol: currencySymbol } = useCurrency();
  const [localSelected, setLocalSelected] = useState([]);

  /* reset selection when modal opens or external selectedIds change */
  const prevOpen = usePrevious(open);
  useEffect(() => {
    if (open && !prevOpen) {
      setLocalSelected(selectedIds || []);
    }
  }, [open, prevOpen, selectedIds]);

  return (
    <Modal open={open} onClose={onClose} title={title || 'Browse Products'} size="large"
      primaryAction={{ content: `Save Selection (${localSelected.length})`, onAction: () => { onSave(localSelected); onClose(); } }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd" tone="subdued">Select the products to include.</Text>
          {allProducts.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued">No products found. Make sure your store has products.</Text>
          ) : (
            <ProductPickerBody products={allProducts} selectedIds={localSelected} setSelectedIds={setLocalSelected} currencySymbol={currencySymbol} resetKey={open} />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/* small hook to track previous value */
function usePrevious(value) {
  const ref = useRef();
  useEffect(() => { ref.current = value; });
  return ref.current;
}

/* ─── IMAGE PLACEHOLDER ───────────────────────────────────────────────────── */
function ImagePlaceholder({ size = 64, image = '' }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '10px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      border: '1px solid #e5e7eb',
      backgroundColor: '#f3f4f6',
      backgroundImage: image ? `url(${image})` : undefined,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }}>
      {!image && (
        <svg width={size * 0.46} height={size * 0.46} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      )}
    </div>
  );
}

/* ─── RULE HELPERS ────────────────────────────────────────────────────────── */
function findProductsByIds(allProducts, ids) {
  return allProducts.filter(p => ids.includes(p.id)).map(p => ({
    id: p.id, title: p.title, handle: p.handle,
    image: p.image, price: p.price,
  }));
}

function scopeLabel(scope) {
  if (scope === 'all') return 'All product pages';
  if (scope === 'single') return 'Specific product page';
  return 'Per-product rules';
}

// "Snowboard", "Snowboard, Gift Card", "Snowboard, Gift Card +3 more" — keeps
// the selection readable in a fixed-width card instead of letting a long list
// blow the layout out.
function summarizeTitles(products, max = 2) {
  const list = products || [];
  if (list.length === 0) return '';
  const shown = list.slice(0, max).map(p => p.title).join(', ');
  return list.length > max ? `${shown} +${list.length - max} more` : shown;
}

// "1 product" / "3 products" — the old copy read "1 trigger products".
function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/* ─── ACCORDION SECTION ───────────────────────────────────────────────────── */
function AccordionSection({ id, icon, title, isOpen, onToggle, tip, children }) {
  return (
    <div style={{
      border: `1px solid ${isOpen ? '#b5e3d8' : '#e5e7eb'}`,
      borderRadius: '10px', overflow: 'hidden',
      transition: 'border-color 0.15s, box-shadow 0.15s',
      boxShadow: isOpen ? '0 0 0 2px rgba(0,128,96,0.06)' : 'none',
    }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', background: isOpen ? '#f6fffe' : '#fafafa', border: 'none',
          cursor: 'pointer', borderBottom: isOpen ? '1px solid #e5e7eb' : 'none',
          transition: 'background 0.15s',
        }}
        aria-expanded={isOpen}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px', flexShrink: 0,
            background: isOpen ? '#e6f4f1' : '#f3f4f6', display: 'flex',
            alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
          }}>
            <Icon source={icon} />
          </div>
          <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
        </div>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: '#637381' }}>
          <Icon source={isOpen ? ChevronUpIcon : ChevronDownIcon} />
        </span>
      </button>
      <Collapsible open={isOpen} id={`fbt-${id}`}>
        <div style={{ padding: '20px 16px', background: '#fff' }}>
          {children}
          {tip && (
            <div style={{ marginTop: '16px', background: '#eef2ff', border: '1px solid #c7d2fe', borderLeft: '3px solid #6366f1', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ minWidth: '18px', width: '18px', height: '18px', borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
                <Icon source={MagicIcon} />
              </span>
              <p style={{ margin: 0, fontSize: '12.5px', color: '#312e81', lineHeight: 1.65 }}>{tip}</p>
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
}

/* ─── SETUP TOUR POINTER ──────────────────────────────────────────────────── */
// A single pointer-tooltip step for the Intelligent Setup Tour: spotlights
// `targetRef`'s element (dimmed backdrop with a cutout ring around it, via
// an oversized box-shadow) and floats a small callout card near it with
// Skip/Next. Deliberately non-blocking (the dim layer has pointerEvents:
// none) — this is a pointer guide, not a modal wizard forcing the merchant
// through steps.
function SetupTourPointer({ targetRef, stepNumber, totalSteps, title, desc, nextLabel, onNext, onBack, onSkip, onUnavailable, canGoBack }) {
  const [rect, setRect] = useState(null);

  // A step whose target element isn't mounted used to be a dead end: the
  // effect bailed, `rect` stayed null so this rendered nothing, and the
  // caller still had a non-null tourStepIndex — which also hides the
  // "Replay setup tour" button. Net effect was the whole tour silently
  // disappearing with no way to get it back. Bail out loudly instead.
  useEffect(() => {
    if (!targetRef.current) onUnavailable?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRef]);

  // Measuring a new target must not keep painting the previous step's
  // spotlight over the wrong element while the effect below catches up.
  useEffect(() => { setRect(null); }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom });
    };
    update();
    const settleTimer = setTimeout(update, 350); // re-measure once the smooth scroll above has likely settled
    window.addEventListener('scroll', update, true); // capture: true also catches nested scroll containers
    window.addEventListener('resize', update);
    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [targetRef]);

  if (!rect) return null;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const cardWidth = 320;
  // ~150px covers this card's real rendered height (header row + title +
  // description + button row) — used only to pick a spot that keeps it
  // fully on-screen, not to size the actual DOM node.
  const cardHeight = 150;
  const margin = 16;
  const spaceBelow = viewportH - rect.bottom;
  const spaceAbove = rect.top;
  let cardTop;
  if (spaceBelow >= cardHeight + margin) {
    cardTop = rect.bottom + 12;
  } else if (spaceAbove >= cardHeight + margin) {
    cardTop = rect.top - cardHeight - 12;
  } else {
    // Target is taller than the viewport (e.g. the whole Customize card
    // once scrolled into view) — neither side has room, so just pin the
    // card near the bottom of the viewport instead of letting it render
    // partly off-screen either way.
    cardTop = viewportH - cardHeight - margin;
  }
  cardTop = Math.max(margin, Math.min(cardTop, viewportH - cardHeight - margin));
  const cardLeft = Math.min(Math.max(rect.left, margin), viewportW - cardWidth - margin);

  return (
    <>
      <div style={{
        position: 'fixed', top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8,
        borderRadius: '10px', border: '2px solid #008060', boxShadow: '0 0 0 4000px rgba(15,17,17,0.5)',
        pointerEvents: 'none', zIndex: 10500,
      }} />
      <div style={{
        position: 'fixed', top: cardTop,
        left: cardLeft, width: `${cardWidth}px`, background: '#202223', color: '#fff',
        borderRadius: '12px', padding: '16px', boxShadow: '0 12px 32px rgba(0,0,0,0.35)', zIndex: 10501,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', color: '#9aa0a3', textTransform: 'uppercase' }}>Step {stepNumber} of {totalSteps}</span>
          <button type="button" onClick={onSkip} aria-label="Skip setup tour" style={{ border: 'none', background: 'transparent', color: '#9aa0a3', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}>&times;</button>
        </div>
        <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '13px', color: '#c9cccf', lineHeight: 1.5, marginBottom: '14px' }}>{desc}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <button type="button" onClick={onSkip} style={{ border: 'none', background: 'transparent', color: '#9aa0a3', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: 0 }}>Skip tour</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {canGoBack && (
              <button type="button" onClick={onBack} style={{ border: '1px solid #45484a', background: 'transparent', color: '#e3e5e7', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: '7px 14px', borderRadius: '8px' }}>Back</button>
            )}
            <button type="button" onClick={onNext} style={{ border: 'none', background: '#008060', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: '8px 16px', borderRadius: '8px' }}>{nextLabel}</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── COLOR FIELD (Solaris-style) ─────────────────────────────────────────── */
function ColorField({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#202223', marginBottom: '6px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #c9cccf', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, background: value, pointerEvents: 'none' }} />
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
            style={{ opacity: 0, width: '150%', height: '150%', cursor: 'pointer', position: 'absolute', top: '-25%', left: '-25%' }} />
        </div>
        <span style={{ fontSize: '13px', color: '#6d7175', fontFamily: 'monospace' }}>{value}</span>
      </div>
    </div>
  );
}

/* ─── COMPONENT ───────────────────────────────────────────────────────────── */
export default function FBTPage() {
  const { shop, fbtConfig, allProducts, manualRules: initialRules, fbtEmbedEnabled, hasSavedFbtConfig } = useLoaderData();
  const { symbol: currencySymbol } = useCurrency();
  const fetcher = useFetcher();
  const { canPublishFeature } = usePlan();
  const fbtPublishable = canPublishFeature('fbt');

  /* state */
  const [isEnabled,         setIsEnabled]         = useState(fbtConfig?.is_enabled !== 0);
  // Free plan can't publish FBT at all — the backend already forces this
  // off in the storefront-facing response regardless of this toggle, so
  // reflect that truthfully in the UI instead of letting the merchant
  // "turn it on" and think it's live.
  const fbtEffectiveEnabled = isEnabled && fbtPublishable;
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [openSection,       setOpenSection]       = useState(null);

  const [selectedTemplate,  setSelectedTemplate]  = useState(apiKeyToTemplateId(fbtConfig.activeTemplate));
  const [interactionStyle,  setInteractionStyle]  = useState(
    fbtConfig.interactionType === 'quickAdd' ? 'quick-add'
      : fbtConfig.interactionType === 'checkboxQty' ? 'checkbox-qty'
      : fbtConfig.interactionType || 'classic'
  );
  const [layout,            setLayout]            = useState(() => {
    const l = fbtConfig.layout || 'carousel';
    if (l === 'horizontal') return 'carousel';
    return l;
  });
  const [bgColor,           setBgColor]           = useState(fbtConfig.bgColor        || '#ffffff');
  const [textColor,         setTextColor]         = useState(fbtConfig.textColor      || '#111827');
  const [priceColor,        setPriceColor]        = useState(fbtConfig.priceColor     || '#059669');
  const [buttonColor,       setButtonColor]       = useState(fbtConfig.buttonColor    || '#111827');
  const [buttonTextColor,   setButtonTextColor]   = useState(fbtConfig.buttonTextColor|| '#ffffff');
  const [borderColor,       setBorderColor]       = useState(fbtConfig.borderColor    || '#e5e7eb');
  const [borderRadius,      setBorderRadius]      = useState(fbtConfig.borderRadius   ?? 8);
  const [showPrices,        setShowPrices]        = useState(fbtConfig.showPrices     !== false);
  const [showAddAll,        setShowAddAll]        = useState(fbtConfig.showAddAllButton !== false);
  const [configMode,        setConfigMode]        = useState(fbtConfig.mode === 'ai' ? 'ai' : 'manual');
  const [fbtCount,          setFbtCount]          = useState(String(fbtConfig.aiProductCount || 6));
  // Tracks whether AI mode has actually been saved to the backend at least
  // once (not just selected in the modal) — gates "Regenerate Suggestions",
  // which only makes sense once there's something to regenerate.
  const [aiConfigured,      setAiConfigured]      = useState(Boolean(fbtConfig.aiEnabled));
  const [placement,         setPlacement]         = useState('all');
  const [widgetPlacement,   setWidgetPlacement]   = useState(fbtConfig.widgetPlacement || 'above_cart');
  const [productStates,     setProductStates]     = useState(defaultProductStates());
  const [hasChanges,        setHasChanges]        = useState(false);
  const [toastActive,       setToastActive]       = useState(false);
  const [manualRules,       setManualRules]       = useState(initialRules || []);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerTarget,      setPickerTarget]      = useState(null); /* 'trigger' | 'fbt' */
  const [draftRule,         setDraftRule]         = useState(null); /* rule being built */
  const [ruleCreatedToast,  setRuleCreatedToast]  = useState(false); /* one-off toast, nothing stays on screen — the rule itself shows up in Saved Rules below */
  const [configureToast,    setConfigureToast]    = useState(false); /* shown when Save is blocked — nothing set up yet in the active mode */

  // ── Intelligent Setup Tour ────────────────────────────────────────────────
  // 3 pointer-tooltip steps (Choose Template / Customize / Configure), each
  // completion check reusing real existing state — no tour-only DB field.
  //   Step 1 Template : hasSavedFbtConfig (a config row exists at all — see
  //                      loader) OR the merchant already swapped templates
  //                      this session, so it updates live as they click one.
  //   Step 2 Customize: hasSavedFbtConfig, OR cn_fbt_setup_customized — set
  //                      the moment a save actually succeeds (below), since
  //                      the template/customize fields share one save and
  //                      one DB row, there's no finer-grained existing signal
  //                      to split them without inventing new tracking.
  //   Step 3 Configure : manualRules.length > 0 (or AI mode already saved),
  //                      exactly as instructed — reuses the same state the
  //                      Quick Setup Guide above already reads.
  const templateStepRef = useRef(null);
  const customizeStepRef = useRef(null);
  const configureStepRef = useRef(null);
  const initialTemplateRef = useRef(selectedTemplate);

  // The tour's memory is per store, so installing on another store starts it there too.
  const fbtKey = (name) => `${name}:${shop}`;

  const [customizedFlag, setCustomizedFlag] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(null); // null = tour hidden

  const templateStepDone = hasSavedFbtConfig || selectedTemplate !== initialTemplateRef.current;
  const customizeStepDone = hasSavedFbtConfig || customizedFlag;
  const configureStepDone = manualRules.length > 0 || Boolean(fbtConfig?.aiEnabled) || aiConfigured;
  const tourStepsDone = [templateStepDone, customizeStepDone, configureStepDone];

  // Single source for the 3 setup tour steps. Completion reuses the real
  // existing signals above, so the tour never points at something already
  // done (see resolveTourStep).
  const SETUP_STEPS = [
    {
      key: 'template',
      ref: templateStepRef,
      tourTitle: 'Choose your template',
      tourDesc: 'Start with a layout that fits how you want your Frequently Bought Together offer to appear.',
      nextLabel: 'Next',
      done: templateStepDone,
    },
    {
      key: 'customize',
      ref: customizeStepRef,
      tourTitle: 'Customize your offer',
      tourDesc: 'Adjust the appearance and content so the FBT widget matches your storefront.',
      nextLabel: 'Next',
      done: customizeStepDone,
    },
    {
      key: 'configure',
      ref: configureStepRef,
      tourTitle: 'Configure your products',
      tourDesc: 'Choose the products that trigger the recommendation and the products you want to offer together.',
      nextLabel: 'Configure',
      done: configureStepDone,
    },
  ];
  const TOUR_STEP_COUNT = SETUP_STEPS.length;

  // Decide the starting step once, on mount — first incomplete step, in
  // order, exactly like the brand-new-merchant example in the spec. Reads
  // localStorage directly here (rather than through customizedFlag state)
  // so the decision isn't made against a stale value from a not-yet-applied
  // state update in the same initial-render pass.
  useEffect(() => {
    let customizedFromStorage = false;
    let tourDismissed = false;
    try {
      customizedFromStorage = localStorage.getItem(fbtKey('cn_fbt_setup_customized')) === '1';
      tourDismissed = localStorage.getItem(fbtKey('cn_fbt_setup_tour_dismissed')) === '1';
    } catch {}
    setCustomizedFlag(customizedFromStorage);
    if (tourDismissed) return;

    const doneFlags = [
      hasSavedFbtConfig,
      hasSavedFbtConfig || customizedFromStorage,
      manualRules.length > 0 || Boolean(fbtConfig?.aiEnabled),
    ];
    // First step that is both incomplete AND has a mounted target — a step
    // whose target doesn't exist is skipped here rather than being opened
    // and then immediately recovered from.
    const refs = [templateStepRef, customizeStepRef, configureStepRef];
    const firstIncomplete = doneFlags.findIndex((done, i) => !done && Boolean(refs[i]?.current));
    if (firstIncomplete === -1) {
      // Only burn the "never show again" flag when the setup is genuinely
      // finished. Landing here because a target wasn't mounted yet must not
      // permanently suppress the tour — leave the flag alone and let the
      // next visit try again.
      if (doneFlags.every(Boolean)) {
        try { localStorage.setItem(fbtKey('cn_fbt_setup_tour_dismissed'), '1'); } catch {}
      }
      return;
    }
    setTourStepIndex(firstIncomplete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Manual "Replay setup tour" (added below, next to Configure) walks all 3
  // steps regardless of completion state — the state-aware skip-ahead logic
  // is for the automatic first-open case; a deliberate replay should show
  // everything, otherwise a shop that already has everything configured
  // (true for every test store touched so far this session) has no way to
  // ever preview it again.
  const [tourManualPreview, setTourManualPreview] = useState(false);

  const finishTour = () => {
    setTourStepIndex(null);
    setTourManualPreview(false);
    try { localStorage.setItem(fbtKey('cn_fbt_setup_tour_dismissed'), '1'); } catch {}
  };

  // Walks from `start` in `dir` (+1/-1) to the first step that is actually
  // showable, and returns -1 if there is none left. Two things disqualify a
  // step:
  //   • its target element isn't mounted — pointing at it would render an
  //     invisible tooltip over nothing, the dead end the recovery logic in
  //     SetupTourPointer already guards against. Checking it up front means
  //     we never even enter that state.
  //   • it's already done (forward auto-advance only) — a merchant who
  //     already has saved rules but never touched Customize starts the tour
  //     there, not at Step 1. Back-navigation and a manual replay both
  //     deliberately keep completed steps.
  const resolveTourStep = (start, dir, { skipCompleted }) => {
    const refs = [templateStepRef, customizeStepRef, configureStepRef];
    for (let i = start; i >= 0 && i < TOUR_STEP_COUNT; i += dir) {
      if (!refs[i]?.current) continue;
      if (skipCompleted && tourStepsDone[i]) continue;
      return i;
    }
    return -1;
  };

  const advanceTour = (fromIndex) => {
    const next = resolveTourStep(fromIndex + 1, 1, { skipCompleted: !tourManualPreview });
    if (next === -1) { finishTour(); return; }
    setTourStepIndex(next);
  };

  // Back never skips completed steps (a deliberate step-back should land
  // where the merchant expects) but still skips unmounted targets, and is a
  // no-op when there's nothing showable behind the current step.
  const backTour = (fromIndex) => {
    const prev = resolveTourStep(fromIndex - 1, -1, { skipCompleted: false });
    if (prev === -1) return;
    setTourStepIndex(prev);
  };

  // Last step's primary action hands the merchant straight into the thing
  // the step is about instead of just closing the tour.
  const finishTourIntoConfigure = () => {
    finishTour();
    setIsConfigModalOpen(true);
  };

  // "Replay setup tour" — the only entry point back into onboarding now that
  // the page-level guide card is gone. Clears the dismissal flag and walks
  // all 3 steps regardless of completion (tourManualPreview), so a shop that
  // already has everything configured can still preview the flow.
  const replayTour = () => {
    setTourManualPreview(true);
    try {
      localStorage.removeItem(fbtKey('cn_fbt_setup_tour_dismissed'));
      // Re-read (never clear) the one key that records real work: the
      // Customize step's completion. Keeps the replayed guide's ticks
      // honest if this state drifted from storage.
      setCustomizedFlag(localStorage.getItem(fbtKey('cn_fbt_setup_customized')) === '1');
    } catch {}
    // Start on the first step whose target actually exists, so a replay can
    // never park tourStepIndex on a missing target. Completed steps are
    // kept — a manual replay is meant to show the whole flow.
    const first = resolveTourStep(0, 1, { skipCompleted: false });
    if (first === -1) { setTourManualPreview(false); setTourStepIndex(null); return; }
    setTourStepIndex(first);
  };

  // If the merchant completes the step the tour is currently pointing at
  // (e.g. saves while on the Customize step) without using the tour's own
  // Next button, move on automatically instead of pointing at something
  // already done. Skipped during a manual replay, which is meant to show
  // every step regardless of what's already done.
  useEffect(() => {
    if (tourStepIndex === null || tourManualPreview) return;
    if (tourStepsDone[tourStepIndex]) advanceTour(tourStepIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateStepDone, customizeStepDone, configureStepDone]);

  // TEMP-DIAG(fbt-setup): remove after verification.
  useEffect(() => {
    /* eslint-disable no-console */
    console.log('[FBT SETUP DEBUG]', {
      fbtPublishable,
      isConfigModalOpen,
      tourStepIndex,
      tourManualPreview,
      tourDismissedLS: (() => { try { return localStorage.getItem(fbtKey('cn_fbt_setup_tour_dismissed')); } catch { return 'ERR'; } })(),
      customizedLS: (() => { try { return localStorage.getItem(fbtKey('cn_fbt_setup_customized')); } catch { return 'ERR'; } })(),
      hasSavedFbtConfig,
      manualRulesCount: manualRules.length,
      selectedTemplate,
      templateStepDone, customizeStepDone, configureStepDone,
      refsMounted: {
        template: !!templateStepRef.current,
        customize: !!customizeStepRef.current,
        configure: !!configureStepRef.current,
      },
      isSaving: fetcher.state !== 'idle',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigModalOpen, tourStepIndex, manualRules.length]);

  const isSaving = fetcher.state !== 'idle';
  const aiCountValid = Number.isInteger(Number(fbtCount)) && Number(fbtCount) > 0;
  const fbtPreviewProducts = buildPreviewProducts(manualRules, allProducts);
  const draftTriggerProducts = draftRule?.triggerIds?.length ? findProductsByIds(allProducts, draftRule.triggerIds) : [];
  const draftFbtProducts     = draftRule?.fbtIds?.length     ? findProductsByIds(allProducts, draftRule.fbtIds)     : [];
  const draftReady = draftTriggerProducts.length > 0 && draftFbtProducts.length > 0;

  // toast on save (success or error) — only clear the dirty flag once the
  // server actually confirms the save, so a failed save leaves Save enabled
  // for the merchant to retry instead of silently graying out.
  // NOTE: this must depend only on fetcher.data, not toastActive — otherwise
  // dismissing the toast (setToastActive(false)) re-triggers this effect,
  // which sees the same fetcher.data still set and immediately flips
  // toastActive back to true, making the Cancel/close button look broken.
  // ALSO guarded against `fetcher.data` itself not having changed: this
  // effect also depends on `configMode` (read below), and fetcher.data is a
  // stable reference that persists across re-renders until the next actual
  // save — so merely switching the Manual/AI mode toggle after a save was
  // re-running this same effect and resurfacing the old "FBT settings
  // saved!" toast as if a brand new save had just happened.
  const lastToastedFetcherDataRef = useRef(null);
  useEffect(() => {
    if (!fetcher.data || fetcher.data === lastToastedFetcherDataRef.current) return;
    lastToastedFetcherDataRef.current = fetcher.data;
    setToastActive(true);
    if (fetcher.data?.success) {
      setHasChanges(false);
      if (configMode === 'ai') setAiConfigured(true);
      // Setup tour's "Customize" step: a successful save is the one clear,
      // reliable signal that real customization work was done and kept —
      // not just that the accordion was opened and closed again.
      try { localStorage.setItem(fbtKey('cn_fbt_setup_customized'), '1'); } catch {}
    }
  }, [fetcher.data, configMode]);

  const mark = () => setHasChanges(true);
  const toggleSection = useCallback((id) => setOpenSection(p => p === id ? null : id), []);

  const applyTemplate = (id) => {
    const t = TEMPLATES.find(x => x.id === id);
    if (!t) return;
    setSelectedTemplate(id);
    setBgColor(t.colors.bg); setTextColor(t.colors.text); setPriceColor(t.colors.price);
    setButtonColor(t.colors.button); setButtonTextColor(t.colors.buttonText);
    setBorderColor(t.colors.border); setBorderRadius(t.borderRadius);
    setProductStates(defaultProductStates());
    // Templates are now purely a color/border "skin" — Layout Alignment is
    // the one universal arrangement control (carousel/grid/vertical) across
    // all 3 templates. Vertical List's whole identity used to BE the list
    // arrangement, so clicking it still defaults Layout Alignment to
    // "vertical" for a sensible first impression — merchants can still
    // freely change it afterward like any other template.
    if (id === 'vertical-list') setLayout('vertical');
    mark();
  };

  const updateProduct = (i, updates) =>
    setProductStates(prev => prev.map((s, idx) => idx === i ? { ...s, ...updates } : s));

  const isActive = (i) => {
    const s = productStates[i];
    return (interactionStyle === 'bundle' || interactionStyle === 'checkbox-qty') ? s.checked : s.added;
  };

  const total = fbtPreviewProducts.reduce((sum, p, i) => isActive(i) ? sum + p.price * productStates[i].qty : sum, 0);
  const activeCount = fbtPreviewProducts.filter((_, i) => isActive(i)).length;

  // Shared by the Save button and the instant enable/disable toggle below —
  // the toggle used to only flip local state and wait for a manual Save
  // click, which looked identical to the Cart Editor's master on/off switch
  // (which *does* save instantly). Merchants toggling FBT off and navigating
  // away without hitting Save would see it keep rendering on the storefront,
  // so the toggle now submits through this same path immediately.
  const submitFbtConfig = (overrides = {}) => {
    const curSettings = {
      layout,
      interactionType: interactionStyle === 'quick-add' ? 'quickAdd'
        : interactionStyle === 'checkbox-qty' ? 'checkboxQty'
        : interactionStyle,
      showPrices, showAddAllButton: showAddAll,
      bgColor, textColor, priceColor, buttonColor, buttonTextColor, borderColor, borderRadius,
    };
    /* build template objects so PHP saves them into temp1/temp2/temp3 columns */
    const templates = {};
    for (const t of TEMPLATES) {
      if (t.id === selectedTemplate) {
        templates[t.apiKey] = { name: t.name, ...curSettings };
      } else {
        templates[t.apiKey] = { name: t.name, layout: 'carousel', interactionType: 'classic',
          showPrices: true, showAddAllButton: true, ...t.colors, borderRadius: t.borderRadius };
      }
    }
    fetcher.submit(
      {
        selectedTemplate: templateIdToApiKey(selectedTemplate),
        isEnabled,
        mode: configMode,
        templates,
        manualRules,
        aiEnabled: configMode === 'ai',
        aiProductCount: Number(fbtCount),
        widgetPlacement,
        ...curSettings,
        shop,
        ...overrides,
      },
      { method: 'POST', encType: 'application/json' }
    );
  };

  // Guards the main Save button only — submitFbtConfig() itself is also
  // called directly for the header's Active/Inactive toggle, which should
  // still work even with no rules/AI set up yet, so the check lives here
  // rather than inside submitFbtConfig.
  const isFbtActuallyConfigured = configMode === 'ai' ? aiCountValid : manualRules.length > 0;
  const handleSave = () => {
    if (!isFbtActuallyConfigured) {
      setConfigureToast(true);
      return;
    }
    submitFbtConfig();
  };

  /* ── renderAction: per-product button based on interaction style ── */
  const renderAction = (i) => {
    const s = productStates[i];
    const btnBase = { borderRadius: `${borderRadius}px`, border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '7px 14px', background: buttonColor, color: buttonTextColor, transition: 'background 0.15s' };

    if (interactionStyle === 'bundle') {
      const isLastChecked = s.checked && activeCount <= 1;
      return (
        <input
          type="checkbox"
          checked={s.checked}
          disabled={isLastChecked}
          onChange={(e) => {
            if (!e.target.checked && activeCount <= 1) return; // at least 1 must stay selected
            updateProduct(i, { checked: e.target.checked });
          }}
          style={{ width: '18px', height: '18px', accentColor: buttonColor, cursor: isLastChecked ? 'not-allowed' : 'pointer', opacity: isLastChecked ? 0.5 : 1, flexShrink: 0 }}
        />
      );
    }

    if (interactionStyle === 'checkbox-qty') {
      // Checkbox itself is rendered directly in the row layout (left of the
      // image) below — this only supplies the quantity stepper that shows
      // once that checkbox is checked.
      if (!s.checked) return null;
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <button onClick={() => updateProduct(i, { qty: Math.max(1, s.qty - 1) })}
            style={{ width: '24px', height: '24px', borderRadius: `${borderRadius}px`, border: `1px solid ${borderColor}`, background: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: textColor, flexShrink: 0 }}>−</button>
          <span style={{ color: textColor, fontSize: '12px', minWidth: '16px', textAlign: 'center', fontWeight: 600 }}>{s.qty}</span>
          <button onClick={() => updateProduct(i, { qty: s.qty + 1 })}
            style={{ width: '24px', height: '24px', borderRadius: `${borderRadius}px`, border: 'none', background: buttonColor, color: buttonTextColor, cursor: 'pointer', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>+</button>
        </div>
      );
    }

    if (interactionStyle === 'quick-add') {
      if (!s.added) return (
        <button onClick={() => updateProduct(i, { added: true })} style={{ ...btnBase, background: '#fff', color: buttonColor, border: `1px solid ${borderColor}` }}>Add</button>
      );
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%' }}>
          <button onClick={() => updateProduct(i, s.qty <= 1 ? { added: false, qty: 1 } : { qty: s.qty - 1 })}
            style={{ width: '28px', height: '28px', borderRadius: `${borderRadius}px`, border: `1px solid ${borderColor}`, background: '#fff', cursor: 'pointer', fontSize: '15px', fontWeight: 700, color: textColor, flexShrink: 0 }}>−</button>
          <span style={{ color: textColor, fontSize: '13px', minWidth: '20px', textAlign: 'center', fontWeight: 600 }}>{s.qty}</span>
          <button onClick={() => updateProduct(i, { qty: s.qty + 1 })}
            style={{ width: '28px', height: '28px', borderRadius: `${borderRadius}px`, border: 'none', background: buttonColor, color: buttonTextColor, cursor: 'pointer', fontSize: '15px', fontWeight: 700, flexShrink: 0 }}>+</button>
        </div>
      );
    }

    return (
      <button onClick={() => updateProduct(i, { added: !s.added })}
        style={{ ...btnBase, background: s.added ? '#008060' : buttonColor, whiteSpace: 'nowrap' }}>
        {s.added ? 'Added' : 'Add'}
      </button>
    );
  };

  /* ── previewProducts: carousel or grid, with per-template card style ── */
  const cardStyle = (() => {
    if (selectedTemplate === 'modern-cards') return {
      background: bgColor,
      borderRadius: `${borderRadius}px`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.13)',
      border: 'none',
      padding: '12px 8px',
    };
    if (selectedTemplate === 'vertical-list') return {
      background: bgColor,
      borderRadius: `${borderRadius}px`,
      border: `1px solid ${borderColor}`,
      borderLeft: `4px solid ${buttonColor}`,
      padding: '10px 8px',
    };
    /* classic-grid */
    return {
      background: bgColor,
      borderRadius: `${borderRadius}px`,
      border: `1px solid ${borderColor}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      padding: '10px 8px',
    };
  })();

  const PreviewCard = ({ p, i }) => (
    <div style={{
      ...cardStyle,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      boxSizing: 'border-box',
    }}>
      <ImagePlaceholder size={56} image={p.image} />
      <div style={{
        color: textColor, fontSize: '11px', fontWeight: 500, lineHeight: 1.35,
        textAlign: 'center', width: '100%',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', wordBreak: 'break-word',
      }}>{p.name}</div>
      {showPrices && (
        <div style={{ color: priceColor, fontSize: '13px', fontWeight: 700, textAlign: 'center' }}>{currencySymbol}{p.price}</div>
      )}
      <div style={{ marginTop: 'auto', width: '100%', display: 'flex', justifyContent: 'center' }}>
        {renderAction(i)}
      </div>
    </div>
  );

  /* Templates are a color/border "skin" only (see cardStyle above) — Layout
     Alignment is the single universal arrangement control (carousel/grid/
     vertical) across all 3 templates, so the same value always means the
     same physical arrangement no matter which template is selected.
     Checkbox + Quantity still always forces the stacked list, since that
     interaction needs the left-side checkbox column regardless of Layout
     Alignment. Classic Grid keeps its signature "+" connector as a skin
     flourish, shown only in the carousel arrangement (a true 2-col grid has
     no natural slot for an inline connector between cells). */
  const useRowLayout = interactionStyle === 'checkbox-qty' || layout === 'vertical';
  const showPlusSeparators = selectedTemplate === 'classic-grid' && !useRowLayout && layout !== 'grid';
  const previewProducts = useRowLayout ? (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {fbtPreviewProducts.map((p, i) => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 2px',
          borderBottom: i < fbtPreviewProducts.length - 1 ? `1px solid ${borderColor}` : 'none',
        }}>
          {interactionStyle === 'checkbox-qty' && (
            <input
              type="checkbox"
              checked={productStates[i].checked}
              disabled={productStates[i].checked && activeCount <= 1}
              onChange={(e) => {
                if (!e.target.checked && activeCount <= 1) return; // at least 1 must stay selected
                updateProduct(i, { checked: e.target.checked });
              }}
              style={{ width: '18px', height: '18px', accentColor: buttonColor, flexShrink: 0, cursor: 'pointer' }}
            />
          )}
          <ImagePlaceholder size={44} image={p.image} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              color: textColor, fontSize: '12px', fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{p.name}</div>
            {showPrices && (
              <div style={{ color: priceColor, fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{currencySymbol}{p.price}</div>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>{renderAction(i)}</div>
        </div>
      ))}
    </div>
  ) : layout === 'grid' ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
      {fbtPreviewProducts.map((p, i) => (
        <PreviewCard key={p.id} p={p} i={i} />
      ))}
    </div>
  ) : (
    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '4px', scrollbarWidth: 'none' }}>
      {fbtPreviewProducts.flatMap((p, i) => {
        const nodes = [
          <div key={p.id} style={{ flex: '0 0 120px', width: '120px', scrollSnapAlign: 'start' }}>
            <PreviewCard p={p} i={i} />
          </div>,
        ];
        if (showPlusSeparators && i < fbtPreviewProducts.length - 1) {
          nodes.push(
            <span key={`plus-${i}`} aria-hidden="true" style={{
              display: 'flex', alignItems: 'center', flexShrink: 0,
              color: textColor, opacity: 0.4, fontSize: '18px', fontWeight: 700,
            }}>+</span>
          );
        }
        return nodes;
      })}
    </div>
  );

  const interactionLabel = INTERACTION_OPTIONS.find(o => o.value === interactionStyle)?.label.split('—')[0].trim() ?? '';
  const templateName = TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? '';

  return (
    <Frame>
      {toastActive && (
        <Toast
          content={fetcher.data?.success ? 'FBT settings saved!' : `Save failed: ${fetcher.data?.error || 'unknown error'}`}
          error={!fetcher.data?.success}
          onDismiss={() => setToastActive(false)}
        />
      )}
      {ruleCreatedToast && (
        <Toast content="FBT rule created" onDismiss={() => setRuleCreatedToast(false)} />
      )}
      {configureToast && (
        <Toast
          content={configMode === 'ai' ? 'Enter a valid FBT product count before saving' : 'Configure at least one FBT rule before saving'}
          error
          onDismiss={() => setConfigureToast(false)}
        />
      )}
      {!isConfigModalOpen && <BrixBar size="md" floating />}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#f6f6f7' }}>

        {/* ── Top bar ── */}
        {/* The action cluster on the right is wide (badge + toggle + Configure
            + Discard + Save + Replay tour). This row used to be a single
            no-wrap flex line inside an `overflow: hidden` page shell, so once
            the embedded-admin viewport got narrow the last items — the
            "Replay setup tour" button first — were pushed past the edge and
            clipped away with no scrollbar, i.e. silently missing. Wrapping
            the row and letting the title block shrink keeps every control
            reachable instead; the actions drop to a second line at worst. */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, rowGap: 6, padding: '7px 14px', background: '#fff', borderBottom: '1px solid #e1e3e5', borderLeft: '4px solid #008060' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: fbtEffectiveEnabled ? '#008060' : '#babec3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ filter: 'brightness(0) invert(1)', display: 'flex' }}><Icon source={ProductIcon} /></div>
          </div>
          <div style={{ minWidth: 0, flex: '1 1 auto' }}>
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingMd">Frequently Bought Together</Text>
              <ProBadge featureKey="fbt" />
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">Cross-sell widget on <span style={{ color: '#008060', fontWeight: 500 }}>product pages</span></Text>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, rowGap: 6, flexShrink: 0 }}>
            <Badge tone={fbtEffectiveEnabled ? 'success' : undefined}>{fbtEffectiveEnabled ? 'Active' : 'Inactive'}</Badge>
            <button
              onClick={() => {
                if (!fbtPublishable) return;
                const next = !isEnabled;
                setIsEnabled(next);
                submitFbtConfig({ isEnabled: next });
              }}
              disabled={!fbtPublishable}
              title={!fbtPublishable ? 'Upgrade to Starter to enable this on your storefront' : undefined}
              style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: fbtEffectiveEnabled ? '#008060' : '#babec3', position: 'relative', cursor: fbtPublishable ? 'pointer' : 'not-allowed', opacity: fbtPublishable ? 1 : 0.5, transition: 'background 0.2s ease', flexShrink: 0, padding: 0 }}
              aria-label="Toggle FBT widget"
            >
              <span style={{ position: 'absolute', top: '3px', left: fbtEffectiveEnabled ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', display: 'block' }} />
            </button>
            <div style={{ width: 1, height: 24, background: '#e1e3e5' }} />
            <div ref={configureStepRef} style={{ display: 'inline-flex' }}>
              <Button icon={SettingsIcon} onClick={() => setIsConfigModalOpen(true)} size="slim">Configure</Button>
            </div>
            <div style={{ width: 1, height: 24, background: '#e1e3e5' }} />
            <Button onClick={() => { setHasChanges(false); }} disabled={!hasChanges} size="slim">Discard</Button>
            <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!hasChanges} size="slim">Save</Button>
            {tourStepIndex === null && (
              <Button icon={PlayIcon} size="slim" onClick={replayTour}>Replay setup tour</Button>
            )}
          </div>
        </div>

          {/* ── Configuration Modal ── */}
          <Modal
            open={isConfigModalOpen}
            onClose={() => setIsConfigModalOpen(false)}
            title="Frequently Bought Together — Configuration"
            size="large"
            primaryAction={{
              content: 'Save',
              loading: isSaving,
              disabled: configMode === 'ai' && !aiCountValid,
              onAction: () => { setIsConfigModalOpen(false); handleSave(); },
            }}
            secondaryActions={[{ content: 'Cancel', onAction: () => setIsConfigModalOpen(false) }]}
          >
            {/* Polaris only offers size="small" (23.75rem) or size="large"
                (61.25rem) — both overshoot what this modal needs, so this
                dials the "large" dialog down to a middle width instead.
                Matched with [class*=...] prefix selectors rather than the
                exact compiled class names: @shopify/polaris 13.9.5 emits
                these unhashed (`Polaris-Modal-Dialog__Modal`), but the build
                has emitted hash-suffixed variants before, and pinning the
                hashes meant the rule silently stopped matching and the
                modal snapped back to the full 61.25rem "large" width. The
                prefix form matches both spellings. */}
            <style>{`
              @media (min-width: 48em) {
                [class*="Polaris-Modal-Dialog__Modal"][class*="Polaris-Modal-Dialog--sizeLarge"] {
                  max-width: 46rem;
                }
              }
            `}</style>

            {/* ── Setup steps ──────────────────────────────────────────────
                 Three explained steps, deliberately unboxed: no card, no
                 border, no background. Each one says what it is and what it
                 does, so the flow reads on its own. Static guidance only —
                 the real trigger/FBT pickers and the existing Create FBT
                 Rule button below remain the only controls. */}
            {configMode === 'manual' && (
              <Modal.Section>
                <div className="brix-qs-row">
                  <style>{`
                    .brix-qs-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px 24px; }
                    .brix-qs-item { display: flex; gap: 9px; align-items: flex-start; min-width: 0; }
                    .brix-qs-n { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: #f1f2f3; color: #6d7175; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
                    .brix-qs-b { min-width: 0; }
                    .brix-qs-t { font-size: 12.5px; font-weight: 600; color: #202223; line-height: 1.35; }
                    .brix-qs-d { font-size: 11.5px; color: #6d7175; line-height: 1.45; margin-top: 2px; }
                  `}</style>
                  {[
                    {
                      n: 1,
                      t: 'Choose the trigger product',
                      d: 'The product whose page shows this recommendation.',
                    },
                    {
                      n: 2,
                      t: 'Add products to recommend',
                      d: 'The items offered alongside the trigger product.',
                    },
                    {
                      n: 3,
                      t: 'Create the rule',
                      d: 'Adds it below, then Save publishes it to your store.',
                    },
                  ].map((s) => (
                    <div key={s.n} className="brix-qs-item">
                      <span className="brix-qs-n">{s.n}</span>
                      <div className="brix-qs-b">
                        <div className="brix-qs-t">{s.t}</div>
                        <div className="brix-qs-d">{s.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Modal.Section>
            )}

            <Modal.Section>
              <style>{`
                .brix-fbt-shell { display: grid; grid-template-columns: 190px 1fr; gap: 28px; align-items: start; }
                @media (max-width: 700px) {
                  .brix-fbt-shell { grid-template-columns: 1fr; gap: 18px; }
                  .brix-fbt-rail { flex-direction: row !important; overflow-x: auto; }
                }
              `}</style>
              <div className="brix-fbt-shell">
                {/* ── Left rail — mode switcher, mirrors the compact icon-rail
                     nav pattern used elsewhere in BRIX instead of a full-width
                     card picker ── */}
                <div className="brix-fbt-rail" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {[
                    { value: 'manual', label: 'Manual', icon: SettingsIcon },
                    { value: 'ai',     label: 'AI-Powered', icon: MagicIcon },
                  ].map((opt) => {
                    const selected = configMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setConfigMode(opt.value)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                          padding: '10px 12px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          textAlign: 'left', background: selected ? '#202223' : 'transparent',
                          color: selected ? '#ffffff' : '#4a4e50', transition: 'background 0.15s ease',
                          flexShrink: 0,
                        }}
                      >
                        <span style={{ display: 'flex', flexShrink: 0 }}><Icon source={opt.icon} /></span>
                        <span style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap' }}>{opt.label}</span>
                        {selected && <span style={{ display: 'flex', marginLeft: 'auto' }}><Icon source={CheckCircleIcon} /></span>}
                      </button>
                    );
                  })}

                  {configMode === 'manual' && (
                    <>
                      <div style={{ height: 1, background: '#e3e5e7', margin: '10px 0' }} />
                      <Text as="p" variant="bodyXs" tone="subdued">{manualRules.length} rule{manualRules.length === 1 ? '' : 's'} saved</Text>
                    </>
                  )}
                </div>

                {/* ── Right pane — active mode's content ── */}
                <div>
                  {configMode === 'ai' && (
                    <BlockStack gap="400">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">AI Coverage Run</Text>
                        <Text as="p" variant="bodyMd" tone="subdued">AI will generate recommendations for every store product and save them directly to backend.</Text>
                      </BlockStack>
                      <TextField
                        label="FBT products per product"
                        type="number"
                        value={fbtCount}
                        onChange={(v) => { setFbtCount(v); mark(); }}
                        autoComplete="off"
                        error={!aiCountValid ? 'Enter a whole number greater than 0.' : undefined}
                        helpText={aiCountValid ? `Example: ${fbtCount} means each product gets ${fbtCount} FBT suggestions.` : undefined}
                      />
                      <InlineStack gap="200">
                        <Button variant="primary" disabled={!aiCountValid} loading={isSaving} onClick={handleSave}>
                          {aiConfigured ? 'Update Configuration' : 'Configure AI'}
                        </Button>
                        {aiConfigured && (
                          <Button disabled={!aiCountValid} loading={isSaving} onClick={handleSave}>Regenerate Suggestions</Button>
                        )}
                      </InlineStack>
                    </BlockStack>
                  )}

                  {configMode === 'manual' && (
                    <BlockStack gap="500">
                      <BlockStack gap="300">
                        <InlineStack gap="150" blockAlign="center">
                          <span style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: '#202223', color: '#fff', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
                          <Text as="h3" variant="headingSm">Where to show FBT</Text>
                        </InlineStack>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '30px' }}>
                          {PLACEMENT_OPTIONS.map((opt) => (
                            <div key={opt.value} style={{
                              borderRadius: '10px', border: `1.5px solid ${placement === opt.value ? '#008060' : '#e3e5e7'}`,
                              background: placement === opt.value ? '#f0faf6' : '#fff', padding: '2px 6px',
                            }}>
                              <RadioButton label={opt.label} helpText={opt.helpText} checked={placement === opt.value} id={`placement-${opt.value}`} name="placement" onChange={() => setPlacement(opt.value)} />
                            </div>
                          ))}
                        </div>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="300">
                        <InlineStack gap="150" blockAlign="center">
                          <span style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: '#202223', color: '#fff', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
                          <Text as="h3" variant="headingSm">Create a rule</Text>
                        </InlineStack>
                        <div style={{ paddingLeft: '30px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          <Text as="p" variant="bodySm" tone="subdued">Pick trigger products (pages where FBT shows) and FBT products (what to recommend).</Text>

                          {/* Two selectors. Each one shows what is actually
                              selected, so the separate green "✓ Trigger / ✓
                              Upsell / → Final step" status panel that used to
                              sit under them is gone — it only restated this. */}
                          <style>{`
                            .brix-pick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
                            .brix-pick { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; text-align: left; font: inherit; cursor: pointer; padding: 11px 13px; border-radius: 10px; border: 1px solid #e3e5e7; background: #fff; transition: border-color .15s, background .15s; }
                            .brix-pick:hover { border-color: #b5bcc2; background: #fafbfb; }
                            .brix-pick:focus-visible { outline: 2px solid #008060; outline-offset: 1px; }
                            .brix-pick[data-filled="true"] { border-color: #008060; }
                            .brix-pick-ico { flex-shrink: 0; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: #f1f2f3; color: #6d7175; }
                            .brix-pick[data-filled="true"] .brix-pick-ico { background: #008060; color: #fff; }
                            .brix-pick-body { display: block; min-width: 0; flex: 1; }
                            .brix-pick-label { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #6d7175; letter-spacing: .01em; }
                            .brix-pick-count { font-variant-numeric: tabular-nums; color: #8c9196; }
                            /* block + nowrap + hidden are all required together,
                               otherwise the ellipsis never kicks in on a span. */
                            .brix-pick-value { display: block; font-size: 12.5px; font-weight: 600; color: #202223; line-height: 1.35; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                            .brix-pick[data-filled="false"] .brix-pick-value { color: #8c9196; font-weight: 500; }
                          `}</style>
                          <div className="brix-pick-grid">
                            {[
                              {
                                key: 'trigger',
                                icon: TargetIcon,
                                label: 'Trigger products',
                                hint: 'Pages the widget appears on',
                                products: draftTriggerProducts,
                              },
                              {
                                key: 'fbt',
                                icon: ProductIcon,
                                label: 'Recommended products',
                                hint: 'What gets offered alongside',
                                products: draftFbtProducts,
                              },
                            ].map((f) => {
                              const filled = f.products.length > 0;
                              return (
                                <button
                                  key={f.key}
                                  type="button"
                                  className="brix-pick"
                                  data-filled={filled}
                                  onClick={() => { setPickerTarget(f.key); setShowProductPicker(true); }}
                                  title={filled ? f.products.map(p => p.title).join(', ') : undefined}
                                >
                                  <span className="brix-pick-ico"><Icon source={f.icon} /></span>
                                  <span className="brix-pick-body">
                                    <span className="brix-pick-label">
                                      {f.label}
                                      {filled && <span className="brix-pick-count">· {pluralize(f.products.length, 'selected')}</span>}
                                    </span>
                                    <span className="brix-pick-value">
                                      {filled ? summarizeTitles(f.products) : f.hint}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          <BlockStack gap="150">
                            <InlineStack gap="200">
                              <Button variant="primary" disabled={!draftReady}
                                onClick={() => {
                                  const rule = {
                                    id: `rule-${Date.now()}`,
                                    displayScope: placement === 'different' ? 'per_product' : placement,
                                    triggerProducts: draftTriggerProducts,
                                    fbtProducts: draftFbtProducts,
                                    aiGenerated: false,
                                  };
                                  setManualRules(prev => [...prev, rule]);
                                  setRuleCreatedToast(true);
                                  setDraftRule(null);
                                  mark();
                                }}
                              >Create FBT rule</Button>
                              {draftRule && (draftRule.triggerIds?.length || draftRule.fbtIds?.length) ? (
                                <Button onClick={() => setDraftRule(null)}>Clear</Button>
                              ) : null}
                            </InlineStack>
                            <Text as="p" variant="bodyXs" tone="subdued">
                              {draftReady
                                ? 'Adds the rule below. Save publishes it to your storefront.'
                                : 'Select a trigger product and at least one recommended product.'}
                            </Text>
                          </BlockStack>
                        </div>
                      </BlockStack>

                      <Divider />

                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Saved rules ({manualRules.length})</Text>
                        {manualRules.length === 0 ? (
                          <Text as="p" variant="bodySm" tone="subdued">No rules yet. Select trigger and recommended products above to create one.</Text>
                        ) : (
                          <>
                            {/* The scope pill used to sit inside a BlockStack,
                                which stretches its children — so it rendered as
                                a full-width stadium instead of a chip. It now
                                lives in its own inline-flex row. */}
                            <style>{`
                              .brix-rules { display: flex; flex-direction: column; gap: 8px; }
                              .brix-rule { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 11px 13px; border-radius: 10px; border: 1px solid #e3e5e7; background: #fff; }
                              .brix-rule-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
                              .brix-rule-scope { align-self: flex-start; display: inline-flex; font-size: 11px; font-weight: 600; padding: 1px 9px; border-radius: 20px; background: #f0faf6; color: #008060; border: 1px solid #b5e3d8; }
                              .brix-rule-line { display: flex; gap: 7px; min-width: 0; font-size: 12px; line-height: 1.4; }
                              .brix-rule-k { flex-shrink: 0; width: 76px; color: #8c9196; font-weight: 600; }
                              .brix-rule-v { min-width: 0; color: #202223; overflow: hidden; text-overflow: ellipsis; }
                              .brix-rule-act { flex-shrink: 0; }
                            `}</style>
                            <div className="brix-rules">
                              {manualRules.map((rule) => (
                                <div key={rule.id} className="brix-rule">
                                  <div className="brix-rule-main">
                                    <span className="brix-rule-scope">{scopeLabel(rule.displayScope)}</span>
                                    <div className="brix-rule-line">
                                      <span className="brix-rule-k">Trigger</span>
                                      <span className="brix-rule-v">{summarizeTitles(rule.triggerProducts) || '—'}</span>
                                    </div>
                                    <div className="brix-rule-line">
                                      <span className="brix-rule-k">Recommends</span>
                                      <span className="brix-rule-v">{summarizeTitles(rule.fbtProducts) || '—'}</span>
                                    </div>
                                  </div>
                                  <div className="brix-rule-act">
                                    <Button variant="plain" tone="critical" onClick={() => { setManualRules(prev => prev.filter(r => r.id !== rule.id)); mark(); }}>Remove</Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </BlockStack>
                    </BlockStack>
                  )}
                </div>
              </div>
            </Modal.Section>
          </Modal>

          {/* ── Product Picker Modal ── */}
          <ProductPickerModal
            open={showProductPicker}
            onClose={() => { setShowProductPicker(false); setPickerTarget(null); }}
            allProducts={allProducts}
            selectedIds={[]}
            onSave={(ids) => {
              if (pickerTarget === 'trigger') {
                setDraftRule(prev => ({ triggerIds: ids, fbtIds: prev?.fbtIds || [] }));
              } else if (pickerTarget === 'fbt') {
                setDraftRule(prev => ({ triggerIds: prev?.triggerIds || [], fbtIds: ids }));
              }
              mark();
            }}
            title={pickerTarget === 'trigger' ? 'Select Trigger Products' : 'Select FBT Products'}
          />

        {/* ── Two-column body ── */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '58% 42%', minHeight: 0, overflow: 'hidden' }}>

          {/* Left column — settings (scrolls internally). Extra bottom padding
              keeps the last field from hiding behind the floating BrixBar
              (fixed at 20px from viewport bottom). */}
          <div style={{ overflowY: 'auto', padding: '12px 12px 100px', borderRight: '1px solid #e1e3e5', display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* Theme embed status — only relevant once the plan can actually
                  publish this; on Free the toggle above is already locked off. */}
              {fbtPublishable && !fbtEmbedEnabled && (
                <Banner
                  title="FBT Widget is not visible on your store yet"
                  tone="warning"
                  action={{ content: 'Enable in theme editor', url: `https://${shop}/admin/themes/current/editor?context=apps`, target: '_blank' }}
                >
                  <p>Go to <strong>App embeds</strong> and turn on <em>FBT Widget</em> to show it on your product pages. Once enabled, <strong>refresh this page</strong> to confirm the status.</p>
                </Banner>
              )}

              {/* Template selector */}
              <div ref={templateStepRef}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Select Template</Text>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t.id)}
                        style={{
                          padding: '7px 18px', borderRadius: '8px', cursor: 'pointer',
                          fontSize: '13px', fontWeight: 500,
                          border: `1.5px solid ${selectedTemplate === t.id ? '#008060' : '#c9cccf'}`,
                          background: selectedTemplate === t.id ? '#f1f8f5' : '#ffffff',
                          color: selectedTemplate === t.id ? '#008060' : '#202223',
                          transition: 'all 0.15s',
                          outline: 'none',
                        }}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </BlockStack>
              </Card>
              </div>

              {/* Customize accordion */}
              <div ref={customizeStepRef}>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Customize: {templateName}</Text>

                  <AccordionSection id="interaction" icon={SettingsIcon} title="Interaction & Layout" isOpen={openSection === 'interaction'} onToggle={toggleSection} tip={SECTION_TIPS.interaction}>
                    <BlockStack gap="300">
                      <Select label="Interaction Style" options={INTERACTION_OPTIONS} value={interactionStyle} onChange={(v) => { setInteractionStyle(v); mark(); }} />
                      <Select
                        label="Layout Alignment"
                        options={LAYOUT_OPTIONS}
                        value={layout}
                        onChange={(v) => { setLayout(v); mark(); }}
                        helpText="Choose how products are arranged — applies to every template."
                      />
                    </BlockStack>
                  </AccordionSection>

                  <AccordionSection id="colors" icon={ColorIcon} title="Colors" isOpen={openSection === 'colors'} onToggle={toggleSection} tip={SECTION_TIPS.colors}>
                    <InlineGrid columns={2} gap="300">
                      <ColorField label="Background"   value={bgColor}         onChange={(v) => { setBgColor(v);         mark(); }} />
                      <ColorField label="Text Color"   value={textColor}       onChange={(v) => { setTextColor(v);       mark(); }} />
                      <ColorField label="Price Color"  value={priceColor}      onChange={(v) => { setPriceColor(v);      mark(); }} />
                      <ColorField label="Button Color" value={buttonColor}     onChange={(v) => { setButtonColor(v);     mark(); }} />
                      <ColorField label="Button Text"  value={buttonTextColor} onChange={(v) => { setButtonTextColor(v); mark(); }} />
                      <ColorField label="Border Color" value={borderColor}     onChange={(v) => { setBorderColor(v);     mark(); }} />
                    </InlineGrid>
                  </AccordionSection>

                  <AccordionSection id="styling" icon={MagicIcon} title="Styling & Display" isOpen={openSection === 'styling'} onToggle={toggleSection} tip={SECTION_TIPS.styling}>
                    <BlockStack gap="300">
                      <SliderField label="Border Radius" value={borderRadius} min={0} max={20} suffix="px" onChange={(v) => { setBorderRadius(v); mark(); }} />
                      <Divider />
                      <Checkbox label="Show Prices"          checked={showPrices}  onChange={(v) => { setShowPrices(v);  mark(); }} />
                      <Checkbox label="Show 'Add All' Button" checked={showAddAll} onChange={(v) => { setShowAddAll(v); mark(); }} />
                      <Divider />
                      <Select
                        label="Widget Placement"
                        helpText={
                          widgetPlacement === 'above_cart' ? 'Pinned above Add to Cart — position locked on storefront.' :
                          widgetPlacement === 'below_cart' ? 'Pinned below Add to Cart — position locked on storefront.' :
                          'Add the block yourself anywhere on the product page via the theme editor.'
                        }
                        options={[
                          { label: 'Above the Add to Cart button', value: 'above_cart' },
                          { label: 'Below the Add to Cart button', value: 'below_cart' },
                          { label: 'Custom (place it yourself in the theme editor)', value: 'custom' },
                        ]}
                        value={widgetPlacement}
                        onChange={(v) => { setWidgetPlacement(v); mark(); }}
                      />
                    </BlockStack>
                  </AccordionSection>
                </BlockStack>
              </Card>
              </div>
            </div>

          {/* Right column — Preview. Extra bottom padding keeps the preview
              footer from hiding behind the floating BrixBar. */}
          <div style={{ overflowY: 'auto', padding: '8px 8px 100px' }}>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Preview</Text>
                <div style={{
                  background: bgColor, borderRadius: '12px', padding: '18px',
                  border: `1px solid ${borderColor}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  zoom: 0.78,
                  transformOrigin: 'top left',
                }}>
                  {/* Preview header */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ color: textColor, fontSize: '15px', fontWeight: 700, marginBottom: '6px' }}>
                      Frequently Bought Together
                    </div>
                    <span style={{
                      display: 'inline-block', fontSize: '11px', padding: '2px 9px', borderRadius: '4px',
                      background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
                      fontWeight: 500,
                    }}>
                      {templateName.split(' ')[0]}
                    </span>
                  </div>

                  {/* Product cards */}
                  {previewProducts}

                  {/* Price summary + CTA */}
                  <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${borderColor}` }}>
                    <div style={{ color: textColor, fontSize: '12px', marginBottom: '12px' }}>
                      {interactionStyle === 'quick-add' ? 'Select items' : `Total (${activeCount} items)`}
                      <br />
                      <span style={{ color: priceColor, fontSize: '20px', fontWeight: 700, lineHeight: 1.3 }}>{currencySymbol}{Math.round(total)}</span>
                    </div>
                    {showAddAll && (
                      <button style={{
                        width: '100%', padding: '13px 16px', borderRadius: `${borderRadius}px`,
                        border: 'none', background: buttonColor, color: buttonTextColor,
                        fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                        letterSpacing: '0.02em', transition: 'opacity 0.15s',
                      }}>
                        {interactionStyle === 'quick-add' ? 'Add to Cart' : `Add ${activeCount || fbtPreviewProducts.length} to Cart`}
                      </button>
                    )}
                  </div>

                  {/* Template label */}
                  <div style={{ textAlign: 'center', marginTop: '14px' }}>
                    <span style={{
                      fontSize: '11px', padding: '3px 16px', borderRadius: '20px',
                      background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
                      fontWeight: 500,
                    }}>
                      {templateName}
                    </span>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </div>
        </div>
      </div>

      {tourStepIndex !== null && (() => {
        const step = SETUP_STEPS[tourStepIndex];
        if (!step) return null;
        const isLast = tourStepIndex === TOUR_STEP_COUNT - 1;
        return (
          <SetupTourPointer
            targetRef={step.ref}
            stepNumber={tourStepIndex + 1}
            totalSteps={TOUR_STEP_COUNT}
            title={step.tourTitle}
            desc={step.tourDesc}
            nextLabel={step.nextLabel}
            // Last step hands straight off to the Configure modal — the
            // obvious next action once the tour has explained the flow.
            onNext={() => (isLast ? finishTourIntoConfigure() : advanceTour(tourStepIndex))}
            onBack={() => backTour(tourStepIndex)}
            canGoBack={resolveTourStep(tourStepIndex - 1, -1, { skipCompleted: false }) !== -1}
            onSkip={finishTour}
            onUnavailable={() => advanceTour(tourStepIndex)}
          />
        );
      })()}
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
