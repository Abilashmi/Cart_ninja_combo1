import { useState, useCallback, useEffect, useRef } from 'react';
import { useLoaderData, useRouteError, useFetcher } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button,
  Select, Checkbox, Divider, RadioButton, RangeSlider, Collapsible,
  Icon, Modal, TextField, Toast, Frame,
} from '@shopify/polaris';
import {
  SettingsIcon, MagicIcon, ColorIcon, ChevronDownIcon, ChevronUpIcon, ProductIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/* ─── LOADER ──────────────────────────────────────────────────────────────── */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  /* fetch products from Shopify */
  let allProducts = [];
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
    allProducts = (prodData?.data?.products?.edges || []).map(e => ({
      id: e.node.id,
      title: e.node.title,
      handle: e.node.handle,
      image: e.node.featuredImage?.url || '',
      price: e.node.variants?.edges?.[0]?.node?.price || '0',
    }));
  } catch (e) { console.error('[FBT loader] products:', e); }

  /* fetch FBT config from local DB */
  let fbtConfig = null;
  let manualRules = [];
  try {
    const db = getDb();
    const [rows] = await db.execute(
      'SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1',
      [shop]
    );
    if (rows.length > 0) {
      const row = rows[0];
      const tpl = parseJson(row.temp1, {});
      fbtConfig = {
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
        aiEnabled: row.ai_enabled === 1 || row.ai_enabled === true,
        aiProductCount: row.ai_product_count ? Number(row.ai_product_count) : 3,
      };
      manualRules = parseJson(row.condition, []);
    }
  } catch (e) { console.error('[FBT loader] DB read:', e.message); }

  return {
    shop,
    allProducts,
    manualRules,
    fbtConfig: fbtConfig ?? {
      activeTemplate: 'fbt1', mode: 'manual', layout: 'horizontal',
      interactionType: 'classic', showPrices: true, showAddAllButton: true,
      bgColor: '#ffffff', textColor: '#111827', priceColor: '#059669',
      buttonColor: '#111827', buttonTextColor: '#ffffff', borderColor: '#e5e7eb',
      borderRadius: 8, aiEnabled: false, aiProductCount: 3,
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
    const mode = body.mode || 'manual';

    const db = getDb();
    await db.execute(
      `INSERT INTO fbt_widget
          (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\`, ai_enabled, ai_product_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
          temp1 = VALUES(temp1),
          temp2 = VALUES(temp2),
          temp3 = VALUES(temp3),
          selectedTemp = VALUES(selectedTemp),
          selectedMode = VALUES(selectedMode),
          \`condition\` = VALUES(\`condition\`),
          ai_enabled = VALUES(ai_enabled),
          ai_product_count = VALUES(ai_product_count),
          updated_at = CURRENT_TIMESTAMP(3)`,
      [
        shop,
        templates.fbt1 ? JSON.stringify(templates.fbt1) : null,
        templates.fbt2 ? JSON.stringify(templates.fbt2) : null,
        templates.fbt3 ? JSON.stringify(templates.fbt3) : null,
        selectedTemplate,
        mode,
        JSON.stringify(manualRules),
        aiEnabled,
        aiProductCount,
      ]
    );
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
  { label: 'Horizontal — Side by side', value: 'horizontal' },
  { label: 'Vertical — Stacked list',   value: 'vertical'   },
];

const PLACEMENT_OPTIONS = [
  { value: 'all',      label: 'Show on all product pages',                    helpText: 'The same FBT products will appear on every product page'              },
  { value: 'specific', label: 'Show on a specific product page',              helpText: 'Select one product page where FBT will appear'                         },
  { value: 'different',label: 'Show different FBT for different product pages',helpText: 'Create multiple rules with different FBT products per page'            },
];

const MOCK_PRODUCTS = [
  { id: 1, name: '100% Organic Handcrafted Kajal', price: 499 },
  { id: 2, name: 'Organic Castor Oil',              price: 499 },
  { id: 3, name: 'Tejas Face Serum',               price: 599 },
];

const SECTION_TIPS = {
  interaction: 'Offering "Add All to Cart" in a single click increases bundle conversion by up to 37% — lower friction means more customers complete the bundle.',
  colors:      'Matching your FBT widget colors to your brand palette boosts trust — 71% of consumers expect a consistent visual experience across all touchpoints.',
  styling:     'Larger product images in FBT widgets increase click-through by 23% — shoppers are 60% more likely to add a product they can clearly see.',
};

const defaultProductStates = () => MOCK_PRODUCTS.map(() => ({ added: true, qty: 1, checked: true }));

function apiKeyToTemplateId(apiKey) {
  return TEMPLATES.find(t => t.apiKey === apiKey)?.id ?? 'classic-grid';
}
function templateIdToApiKey(id) {
  return TEMPLATES.find(t => t.id === id)?.apiKey ?? 'fbt1';
}

/* ─── PRODUCT PICKER MODAL ────────────────────────────────────────────────── */
function ProductPickerModal({ open, onClose, allProducts, selectedIds, onSave, title }) {
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
                      <Text tone="subdued" variant="bodyXs">₹{product.price}</Text>
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
    <div style={{ border: `1.5px solid ${isOpen ? '#b5e3d8' : '#e1e3e5'}`, borderRadius: '10px', overflow: 'hidden', transition: 'border-color 0.15s' }}>
      <button
        onClick={() => onToggle(id)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: isOpen ? '#f6fffe' : '#fff', border: 'none', cursor: 'pointer', borderBottom: isOpen ? '1px solid #e1e3e5' : 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '7px', flexShrink: 0, background: isOpen ? '#dcfce7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
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
              <span style={{ minWidth: '20px', width: '20px', height: '20px', borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                <Icon source={MagicIcon} />
              </span>
              <p style={{ margin: 0, fontSize: '13px', color: '#312e81', lineHeight: 1.6 }}>{tip}</p>
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
  const { shop, fbtConfig, allProducts, manualRules: initialRules } = useLoaderData();
  const fetcher = useFetcher();

  /* state */
  const [isEnabled,         setIsEnabled]         = useState(true);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [openSection,       setOpenSection]       = useState(null);

  const [selectedTemplate,  setSelectedTemplate]  = useState(apiKeyToTemplateId(fbtConfig.activeTemplate));
  const [interactionStyle,  setInteractionStyle]  = useState(fbtConfig.interactionType === 'quickAdd' ? 'quick-add' : fbtConfig.interactionType || 'classic');
  const [layout,            setLayout]            = useState(fbtConfig.layout || 'horizontal');
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
  const [placement,         setPlacement]         = useState('all');
  const [productStates,     setProductStates]     = useState(defaultProductStates());
  const [hasChanges,        setHasChanges]        = useState(false);
  const [toastActive,       setToastActive]       = useState(false);
  const [manualRules,       setManualRules]       = useState(initialRules || []);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [pickerTarget,      setPickerTarget]      = useState(null); /* 'trigger' | 'fbt' */
  const [draftRule,         setDraftRule]         = useState(null); /* rule being built */

  const isSaving = fetcher.state !== 'idle';

  // toast on save
  useEffect(() => {
    if (fetcher.data?.success && !toastActive) setToastActive(true);
  }, [fetcher.data?.success, toastActive]);

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

  const total = MOCK_PRODUCTS.reduce((sum, p, i) => isActive(i) ? sum + p.price * productStates[i].qty : sum, 0);
  const activeCount = MOCK_PRODUCTS.filter((_, i) => isActive(i)).length;

  const handleSave = () => {
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
        templates[t.apiKey] = { name: t.name, layout: 'horizontal', interactionType: 'classic',
          showPrices: true, showAddAllButton: true, ...t.colors, borderRadius: t.borderRadius };
      }
    }
    fetcher.submit(
      {
        selectedTemplate: templateIdToApiKey(selectedTemplate),
        mode: configMode,
        templates,
        manualRules,
        aiEnabled: configMode === 'ai',
        aiProductCount: Number(fbtCount),
        ...curSettings,
        shop,
      },
      { method: 'POST', encType: 'application/json' }
    );
    setHasChanges(false);
  };

  /* ── renderAction: per-product button based on interaction style ── */
  const renderAction = (i) => {
    const s = productStates[i];
    const btnBase = { borderRadius: `${borderRadius}px`, border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: '5px 12px', background: buttonColor, color: buttonTextColor };

    if (interactionStyle === 'bundle') {
      return (
        <input type="checkbox" checked={s.checked} onChange={(e) => updateProduct(i, { checked: e.target.checked })}
          style={{ width: '18px', height: '18px', accentColor: buttonColor, cursor: 'pointer', flexShrink: 0 }} />
      );
    }

    if (interactionStyle === 'quick-add') {
      if (!s.added) return (
        <button onClick={() => updateProduct(i, { added: true })} style={{ ...btnBase, background: '#fff', color: buttonColor, border: `1px solid ${borderColor}` }}>Add</button>
      );
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button onClick={() => updateProduct(i, s.qty <= 1 ? { added: false, qty: 1 } : { qty: s.qty - 1 })}
            style={{ width: '26px', height: '26px', borderRadius: `${borderRadius}px`, border: `1px solid ${borderColor}`, background: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 700, color: textColor }}>−</button>
          <span style={{ color: textColor, fontSize: '13px', minWidth: '18px', textAlign: 'center' }}>{s.qty}</span>
          <button onClick={() => updateProduct(i, { qty: s.qty + 1 })}
            style={{ width: '26px', height: '26px', borderRadius: `${borderRadius}px`, border: 'none', background: buttonColor, color: buttonTextColor, cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>+</button>
        </div>
      );
    }

    return (
      <button onClick={() => updateProduct(i, { added: !s.added })}
        style={{ ...btnBase, background: s.added ? '#008060' : buttonColor, whiteSpace: 'nowrap' }}>
        {s.added ? 'Added ✓' : 'Add'}
      </button>
    );
  };

  /* ── previewProducts: per-template product grid ── */
  const previewProducts = (() => {
    if (selectedTemplate === 'classic-grid') {
      if (layout === 'horizontal') {
        return (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: '6px' }}>
            {MOCK_PRODUCTS.map((p, i) => (
              <div key={p.id} style={{ display: 'contents' }}>
                <div style={{ flex: 1, background: '#fff', border: `1px solid ${borderColor}`, borderRadius: `${borderRadius}px`, padding: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '48px', height: '48px', background: '#f3f4f6', borderRadius: '6px', flexShrink: 0 }} />
                  <div style={{ color: textColor, fontSize: '11px', textAlign: 'center', lineHeight: 1.3 }}>{p.name}</div>
                  <div style={{ flex: 1 }} />
                  {showPrices && <div style={{ color: priceColor, fontSize: '12px', fontWeight: 700, textAlign: 'center', width: '100%' }}>₹{p.price}</div>}
                  {renderAction(i)}
                </div>
                {i < MOCK_PRODUCTS.length - 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', color: textColor, fontSize: '20px', fontWeight: 300, opacity: 0.4, flexShrink: 0, padding: '0 2px' }}>+</div>
                )}
              </div>
            ))}
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {MOCK_PRODUCTS.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: '#fff', borderRadius: `${borderRadius}px`, border: `1px solid ${borderColor}` }}>
              <div style={{ width: '44px', height: '44px', background: '#f3f4f6', borderRadius: '6px', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: textColor, fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                {showPrices && <div style={{ color: priceColor, fontSize: '12px', fontWeight: 700 }}>₹{p.price}</div>}
              </div>
              {renderAction(i)}
            </div>
          ))}
        </div>
      );
    }

    if (selectedTemplate === 'modern-cards') {
      if (layout === 'horizontal') {
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            {MOCK_PRODUCTS.map((p, i) => (
              <div key={p.id} style={{ background: '#fff', borderRadius: `${borderRadius}px`, boxShadow: '0 2px 10px rgba(0,0,0,0.10)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ width: '100%', aspectRatio: '1/1', borderRadius: `${Math.max(borderRadius - 2, 4)}px`, background: `linear-gradient(135deg, ${buttonColor}30 0%, ${priceColor}20 100%)` }} />
                <div style={{ color: textColor, fontSize: '11px', fontWeight: 500, lineHeight: 1.3 }}>{p.name}</div>
                {showPrices && <div style={{ color: priceColor, fontSize: '13px', fontWeight: 700 }}>₹{p.price}</div>}
                <div style={{ marginTop: 'auto' }}>{renderAction(i)}</div>
              </div>
            ))}
          </div>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {MOCK_PRODUCTS.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: '#fff', borderRadius: `${borderRadius}px`, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <div style={{ width: '46px', height: '46px', flexShrink: 0, borderRadius: `${Math.max(borderRadius - 2, 4)}px`, background: `linear-gradient(135deg, ${buttonColor}30 0%, ${priceColor}20 100%)` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: textColor, fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                {showPrices && <div style={{ color: priceColor, fontSize: '13px', fontWeight: 700 }}>₹{p.price}</div>}
              </div>
              {renderAction(i)}
            </div>
          ))}
        </div>
      );
    }

    // vertical-list
    return (
      <div style={{ borderRadius: `${borderRadius}px`, overflow: 'hidden', border: `1px solid ${borderColor}40` }}>
        {MOCK_PRODUCTS.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: i % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)', borderTop: i > 0 ? `1px solid ${borderColor}30` : 'none', borderLeft: `3px solid ${buttonColor}` }}>
            <div style={{ width: '40px', height: '40px', background: 'rgba(255,255,255,0.25)', borderRadius: '6px', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: textColor, fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              {showPrices && <div style={{ color: priceColor, fontSize: '12px', fontWeight: 700 }}>₹{p.price}</div>}
            </div>
            {renderAction(i)}
          </div>
        ))}
      </div>
    );
  })();

  const interactionLabel = INTERACTION_OPTIONS.find(o => o.value === interactionStyle)?.label.split('—')[0].trim() ?? '';
  const templateName = TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? '';

  return (
    <Frame>
      {toastActive && <Toast content="FBT settings saved!" onDismiss={() => setToastActive(false)} />}

      <Page
        title="Frequently Bought Together"
        subtitle="Recommend products that customers frequently purchase together."
        primaryAction={{ content: isSaving ? 'Saving…' : 'Save', onAction: handleSave, loading: isSaving, disabled: !hasChanges }}
        secondaryActions={[{ content: 'Discard', onAction: () => { setHasChanges(false); } }]}
      >
        <BlockStack gap="400">

          {/* ── Status card ── */}
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="300" blockAlign="center">
                <div style={{ width: '42px', height: '42px', borderRadius: '10px', flexShrink: 0, background: isEnabled ? '#f1f8f5' : '#f6f6f7', border: `1px solid ${isEnabled ? '#b5e3d8' : '#e1e3e5'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon source={ProductIcon} />
                </div>
                <BlockStack gap="050">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">Frequently Bought Together</Text>
                    <Badge tone={isEnabled ? 'success' : undefined}>{isEnabled ? 'Active' : 'Inactive'}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">Show product bundle recommendations on your product pages</Text>
                </BlockStack>
              </InlineStack>

              <InlineStack gap="300" blockAlign="center">
                <InlineStack gap="150" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">{isEnabled ? 'On' : 'Off'}</Text>
                  <button
                    onClick={() => { setIsEnabled(p => !p); mark(); }}
                    style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', background: isEnabled ? '#008060' : '#babec3', position: 'relative', cursor: 'pointer', transition: 'background 0.2s ease', flexShrink: 0, padding: 0 }}
                  >
                    <span style={{ position: 'absolute', top: '3px', left: isEnabled ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#ffffff', transition: 'left 0.2s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', display: 'block' }} />
                  </button>
                </InlineStack>
                <div style={{ width: '1px', height: '24px', background: '#e1e3e5' }} />
                <Button icon={SettingsIcon} onClick={() => setIsConfigModalOpen(true)}>Configure</Button>
              </InlineStack>
            </InlineStack>
          </Card>

          {/* ── Configuration Modal ── */}
          <Modal
            open={isConfigModalOpen}
            onClose={() => setIsConfigModalOpen(false)}
            title="Frequently Bought Together — Configuration"
            primaryAction={{ content: 'Save', onAction: () => { setIsConfigModalOpen(false); mark(); } }}
            secondaryActions={[{ content: 'Cancel', onAction: () => setIsConfigModalOpen(false) }]}
          >
            <Modal.Section>
              <BlockStack gap="400">
                <Text as="h3" variant="headingSm">Configuration Mode</Text>
                <BlockStack gap="200">
                  {[
                    { value: 'manual', label: 'Manual Configuration', desc: 'Manually set which products to upsell',     icon: SettingsIcon },
                    { value: 'ai',     label: 'AI Configuration (OpenAI)', desc: 'Let AI suggest products automatically', icon: MagicIcon    },
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
                  <TextField
                    label="FBT products per product"
                    type="number"
                    value={fbtCount}
                    onChange={setFbtCount}
                    autoComplete="off"
                    helpText={`Example: ${fbtCount} means each product gets ${fbtCount} FBT suggestions.`}
                  />
                  <InlineStack gap="200">
                    <Button variant="primary">Configure AI</Button>
                    <Button>Regenerate Suggestions</Button>
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

          {/* ── Select Template + Customize  |  Preview ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'stretch' }}>

            {/* Left column */}
            <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: '16px', height: '100%' }}>

              {/* Template selector */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Select Template</Text>
                  <InlineStack gap="200">
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t.id)}
                        style={{ padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, border: `1.5px solid ${selectedTemplate === t.id ? '#008060' : '#c9cccf'}`, background: selectedTemplate === t.id ? '#f1f8f5' : '#ffffff', color: selectedTemplate === t.id ? '#008060' : '#202223' }}
                      >
                        {t.name}
                      </button>
                    ))}
                  </InlineStack>
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
                      <RangeSlider label={`Border Radius: ${borderRadius}px`} value={borderRadius} min={0} max={20} onChange={(v) => { setBorderRadius(v); mark(); }} output />
                      <Divider />
                      <Checkbox label="Show Prices"          checked={showPrices}  onChange={(v) => { setShowPrices(v);  mark(); }} />
                      <Checkbox label="Show 'Add All' Button" checked={showAddAll} onChange={(v) => { setShowAddAll(v); mark(); }} />
                    </BlockStack>
                  </AccordionSection>
                </BlockStack>
              </Card>
            </div>

            {/* Right column — Preview */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Preview</Text>
                <div style={{ background: bgColor, borderRadius: '10px', padding: '16px' }}>
                  <div style={{ color: textColor, fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>
                    Frequently Bought Together
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.25)', color: textColor, border: `1px solid ${borderColor}44` }}>
                      {interactionLabel}
                    </span>
                  </div>

                  {previewProducts}

                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${borderColor}44` }}>
                    <div style={{ color: textColor, fontSize: '12px', marginBottom: '8px' }}>
                      {interactionStyle === 'quick-add' ? 'Select items' : `Total (${activeCount} items)`}
                      <br />
                      <span style={{ color: priceColor, fontSize: '16px', fontWeight: 700 }}>₹{total}</span>
                    </div>
                    {showAddAll && (
                      <button style={{ width: '100%', padding: '10px', borderRadius: `${borderRadius}px`, border: 'none', background: buttonColor, color: buttonTextColor, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                        {interactionStyle === 'quick-add' ? 'Add to Cart' : `Add ${activeCount || MOCK_PRODUCTS.length} to Cart`}
                      </button>
                    )}
                  </div>

                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <span style={{ fontSize: '11px', padding: '2px 12px', borderRadius: '20px', background: 'rgba(255,255,255,0.2)', color: textColor, border: `1px solid ${borderColor}44` }}>
                      {templateName}
                    </span>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </div>

        </BlockStack>
      </Page>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
