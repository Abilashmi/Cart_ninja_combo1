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
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { ProBadge } from '../components/plan/PlanGate';
import { usePlan } from '../components/PlanContext';
import { useCurrency } from '../components/CurrencyContext';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
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
        r.displayScope || r.trigger_scope || 'all',
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
  { label: 'Classic — Individual Add / Remove', value: 'classic'   },
  { label: 'Quick Add — Quantity Stepper',      value: 'quick-add' },
  { label: 'Bundle — Minimum 1 Required',       value: 'bundle'    },
];

const LAYOUT_OPTIONS = [
  { label: 'Carousel — Horizontal scroll', value: 'carousel' },
  { label: 'Grid — 2-column grid',         value: 'grid'     },
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

  const toggle = (id) => setLocalSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  return (
    <Modal open={open} onClose={onClose} title={title || 'Browse Products'}
      primaryAction={{ content: `Save Selection (${localSelected.length})`, onAction: () => { onSave(localSelected); onClose(); } }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd" tone="subdued">Select the products to include.</Text>
          {allProducts.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued">No products found. Make sure your store has products.</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>
              {allProducts.map(product => {
                const sel = localSelected.includes(product.id);
                return (
                  <div key={product.id} onClick={() => toggle(product.id)}
                    style={{
                      padding: '8px 10px', border: sel ? '2px solid #2c6ecb' : '1px solid #e5e7eb',
                      borderRadius: '8px', background: sel ? '#f0f7ff' : '#fff',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                    }}
                  >
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '6px', overflow: 'hidden',
                      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f8fafc', border: '1px solid #f1f5f9',
                    }}>
                      {product.image ? (
                        <img src={product.image} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : <span>📦</span>}
                    </div>
                    <BlockStack gap="050" style={{ flex: 1, minWidth: 0 }}>
                      <Text fontWeight="bold" variant="bodySm">{product.title}</Text>
                      <Text tone="subdued" variant="bodyXs">{currencySymbol}{product.price}</Text>
                    </BlockStack>
                    {sel && <span style={{ color: '#2c6ecb', fontSize: '18px', fontWeight: 700 }}>✓</span>}
                  </div>
                );
              })}
            </div>
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
  const { shop, fbtConfig, allProducts, manualRules: initialRules, fbtEmbedEnabled } = useLoaderData();
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
  const [interactionStyle,  setInteractionStyle]  = useState(fbtConfig.interactionType === 'quickAdd' ? 'quick-add' : fbtConfig.interactionType || 'classic');
  const [layout,            setLayout]            = useState(() => {
    const l = fbtConfig.layout || 'carousel';
    if (l === 'horizontal') return 'carousel';
    if (l === 'vertical')   return 'grid';
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

  const isSaving = fetcher.state !== 'idle';
  const aiCountValid = Number.isInteger(Number(fbtCount)) && Number(fbtCount) > 0;
  const fbtPreviewProducts = buildPreviewProducts(manualRules, allProducts);

  // toast on save (success or error) — only clear the dirty flag once the
  // server actually confirms the save, so a failed save leaves Save enabled
  // for the merchant to retry instead of silently graying out.
  // NOTE: this must depend only on fetcher.data, not toastActive — otherwise
  // dismissing the toast (setToastActive(false)) re-triggers this effect,
  // which sees the same fetcher.data still set and immediately flips
  // toastActive back to true, making the Cancel/close button look broken.
  useEffect(() => {
    if (fetcher.data) setToastActive(true);
    if (fetcher.data?.success) {
      setHasChanges(false);
      if (configMode === 'ai') setAiConfigured(true);
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
    mark();
  };

  const updateProduct = (i, updates) =>
    setProductStates(prev => prev.map((s, idx) => idx === i ? { ...s, ...updates } : s));

  const isActive = (i) => {
    const s = productStates[i];
    return interactionStyle === 'bundle' ? s.checked : s.added;
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
      interactionType: interactionStyle === 'quick-add' ? 'quickAdd' : interactionStyle,
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

  const handleSave = () => submitFbtConfig();

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

  /* The 3 templates are meant to be genuinely different structural layouts,
     not just recolored cards — Classic Grid is a connected row joined by "+"
     separators, Vertical List is stacked full-width rows, and Modern Cards
     keeps the existing carousel/grid card arrangement (with its own
     borderless/shadowed cardStyle already applied above). Previously this
     preview only ever rendered PreviewCard in a carousel-or-grid shell for
     all 3 templates, so switching templates looked like nothing changed. */
  const previewProducts = selectedTemplate === 'vertical-list' ? (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {fbtPreviewProducts.map((p, i) => (
        <div key={p.id} style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 2px',
          borderBottom: i < fbtPreviewProducts.length - 1 ? `1px solid ${borderColor}` : 'none',
        }}>
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
  ) : selectedTemplate === 'classic-grid' ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '10px' }}>
      {fbtPreviewProducts.flatMap((p, i) => {
        const nodes = [
          <div key={p.id} style={{ flex: '1 1 90px', minWidth: '90px' }}>
            <PreviewCard p={p} i={i} />
          </div>,
        ];
        if (i < fbtPreviewProducts.length - 1) {
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
  ) : layout === 'carousel' ? (
    <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '4px', scrollbarWidth: 'none' }}>
      {fbtPreviewProducts.map((p, i) => (
        <div key={p.id} style={{ flex: '0 0 120px', width: '120px', scrollSnapAlign: 'start' }}>
          <PreviewCard p={p} i={i} />
        </div>
      ))}
    </div>
  ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
      {fbtPreviewProducts.map((p, i) => (
        <PreviewCard key={p.id} p={p} i={i} />
      ))}
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
      {!isConfigModalOpen && <BrixBar size="md" floating />}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#f6f6f7' }}>

        {/* ── Top bar ── */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', background: '#fff', borderBottom: '1px solid #e1e3e5', borderLeft: '4px solid #008060' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: fbtEffectiveEnabled ? '#008060' : '#babec3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ filter: 'brightness(0) invert(1)', display: 'flex' }}><Icon source={ProductIcon} /></div>
          </div>
          <div>
            <InlineStack gap="200" blockAlign="center">
              <Text as="h1" variant="headingMd">Frequently Bought Together</Text>
              <ProBadge featureKey="fbt" />
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">Cross-sell widget on <span style={{ color: '#008060', fontWeight: 500 }}>product pages</span></Text>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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
            <Button icon={SettingsIcon} onClick={() => setIsConfigModalOpen(true)} size="slim">Configure</Button>
            <div style={{ width: 1, height: 24, background: '#e1e3e5' }} />
            <Button onClick={() => { setHasChanges(false); }} disabled={!hasChanges} size="slim">Discard</Button>
            <Button variant="primary" onClick={handleSave} loading={isSaving} disabled={!hasChanges} size="slim">Save</Button>
          </div>
        </div>

          {/* ── Configuration Modal ── */}
          <Modal
            open={isConfigModalOpen}
            onClose={() => setIsConfigModalOpen(false)}
            title="Frequently Bought Together — Configuration"
            primaryAction={{
              content: 'Save',
              loading: isSaving,
              disabled: configMode === 'ai' && !aiCountValid,
              onAction: () => { setIsConfigModalOpen(false); handleSave(); },
            }}
            secondaryActions={[{ content: 'Cancel', onAction: () => setIsConfigModalOpen(false) }]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">Configuration Mode</Text>
                <BlockStack gap="200">
                  {[
                    { value: 'manual', label: 'Manual Configuration', desc: 'Manually set which products to upsell',     icon: SettingsIcon },
                    { value: 'ai',     label: 'AI Configuration', desc: 'Let AI suggest products automatically', icon: MagicIcon    },
                  ].map((opt) => (
                    <div
                      key={opt.value}
                      onClick={() => setConfigMode(opt.value)}
                      style={{ padding: '14px 16px', borderRadius: '8px', cursor: 'pointer', border: `1.5px solid ${configMode === opt.value ? '#008060' : '#e1e3e5'}`, background: configMode === opt.value ? '#f1f8f5' : '#ffffff', display: 'flex', alignItems: 'flex-start', gap: '12px' }}
                    >
                      <input type="radio" readOnly checked={configMode === opt.value} style={{ marginTop: '3px', accentColor: '#008060', cursor: 'pointer', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ display: 'flex', flexShrink: 0 }}><Icon source={opt.icon} /></span>
                          <span style={{ fontWeight: 600, fontSize: '14px', color: '#202223' }}>{opt.label}</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '13px', color: '#6d7175', lineHeight: 1.5 }}>{opt.desc}</p>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Modal.Section>

            {configMode === 'ai' && (
              <Modal.Section>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">AI Coverage Run</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">AI will generate recommendations for every store product and save them directly to backend.</Text>
                  </BlockStack>
                  {aiConfigured && (
                    <Banner tone="success">AI Configured — suggestions are generating for every product.</Banner>
                  )}
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
              </Modal.Section>
            )}

            {configMode === 'manual' && (
              <Modal.Section>
                <BlockStack gap="500">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">Manual Upsell Rules</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Configure where to show FBT recommendations and which products to suggest.</Text>
                  </BlockStack>

                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Step 1: Where to show FBT</Text>
                    <BlockStack gap="100">
                      {PLACEMENT_OPTIONS.map((opt) => (
                        <RadioButton key={opt.value} label={opt.label} helpText={opt.helpText} checked={placement === opt.value} id={`placement-${opt.value}`} name="placement" onChange={() => setPlacement(opt.value)} />
                      ))}
                    </BlockStack>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Step 2: Create a rule</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Pick trigger products (pages where FBT shows) and FBT products (what to recommend).</Text>

                    {/* draft status badges */}
                    <InlineStack gap="200">
                      <div style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: `1.5px solid ${draftRule?.triggerIds?.length ? '#008060' : '#e1e3e5'}`, background: draftRule?.triggerIds?.length ? '#f1f8f5' : '#fff', cursor: 'pointer' }} onClick={() => { setPickerTarget('trigger'); setShowProductPicker(true); }}>
                        <Text as="p" variant="bodySm" fontWeight="semibold">{draftRule?.triggerIds?.length || 0} trigger products</Text>
                        <Text as="p" variant="bodyXs" tone="subdued">Click to browse & select</Text>
                      </div>
                      <div style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: `1.5px solid ${draftRule?.fbtIds?.length ? '#008060' : '#e1e3e5'}`, background: draftRule?.fbtIds?.length ? '#f1f8f5' : '#fff', cursor: 'pointer' }} onClick={() => { setPickerTarget('fbt'); setShowProductPicker(true); }}>
                        <Text as="p" variant="bodySm" fontWeight="semibold">{draftRule?.fbtIds?.length || 0} FBT products</Text>
                        <Text as="p" variant="bodyXs" tone="subdued">Click to browse & select</Text>
                      </div>
                    </InlineStack>

                    <InlineStack gap="200">
                      <Button variant="primary" disabled={!draftRule?.triggerIds?.length || !draftRule?.fbtIds?.length}
                        onClick={() => {
                          const rule = {
                            id: `rule-${Date.now()}`,
                            displayScope: placement === 'different' ? 'per_product' : placement,
                            triggerProducts: findProductsByIds(allProducts, draftRule.triggerIds),
                            fbtProducts: findProductsByIds(allProducts, draftRule.fbtIds),
                            aiGenerated: false,
                          };
                          setManualRules(prev => [...prev, rule]);
                          setDraftRule(null);
                          mark();
                        }}
                      >Add Rule</Button>
                      {draftRule && (draftRule.triggerIds?.length || draftRule.fbtIds?.length) ? (
                        <Button onClick={() => setDraftRule(null)}>Clear</Button>
                      ) : null}
                    </InlineStack>
                  </BlockStack>

                  <Divider />

                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Saved Rules ({manualRules.length})</Text>
                    {manualRules.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">No rules yet. Select trigger and FBT products above to create one.</Text>
                    ) : (
                      <div style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
                        {manualRules.map((rule, i) => (
                          <div key={rule.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: i > 0 ? '1px solid #e1e3e5' : 'none' }}>
                            <BlockStack gap="100">
                              <span style={{ fontSize: '12px', padding: '2px 10px', borderRadius: '4px', background: '#f1f8f5', color: '#008060', border: '1px solid #b5e3d8', display: 'inline-block' }}>{scopeLabel(rule.displayScope)}</span>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Trigger: {(rule.triggerProducts || []).slice(0, 2).map(p => p.title).join(', ')}{(rule.triggerProducts || []).length > 2 ? ` +${rule.triggerProducts.length - 2} more` : ''}
                                {' | '}FBT: {(rule.fbtProducts || []).slice(0, 2).map(p => p.title).join(', ')}{(rule.fbtProducts || []).length > 2 ? ` +${rule.fbtProducts.length - 2} more` : ''}
                              </Text>
                            </BlockStack>
                            <Button variant="plain" tone="critical" onClick={() => { setManualRules(prev => prev.filter(r => r.id !== rule.id)); mark(); }}>Remove</Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </BlockStack>
                </BlockStack>
              </Modal.Section>
            )}
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

              {/* Customize accordion */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Customize: {templateName}</Text>

                  <AccordionSection id="interaction" icon={SettingsIcon} title="Interaction & Layout" isOpen={openSection === 'interaction'} onToggle={toggleSection} tip={SECTION_TIPS.interaction}>
                    <BlockStack gap="300">
                      <Select label="Interaction Style" options={INTERACTION_OPTIONS} value={interactionStyle} onChange={(v) => { setInteractionStyle(v); mark(); }} />
                      <Select label="Layout Alignment" options={LAYOUT_OPTIONS} value={layout} onChange={(v) => { setLayout(v); mark(); }} />
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
                      <span style={{ color: priceColor, fontSize: '20px', fontWeight: 700, lineHeight: 1.3 }}>{currencySymbol}{total}</span>
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
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
