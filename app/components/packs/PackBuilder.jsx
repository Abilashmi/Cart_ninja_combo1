/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, ButtonGroup, TextField, Banner, Tabs, Divider, Badge, Box, Thumbnail, SkeletonBodyText, Spinner, Icon, RangeSlider } from '@shopify/polaris';
import { DesktopIcon, MobileIcon, SearchIcon, PersonIcon, CartIcon, DeleteIcon, PlusIcon, TextBlockIcon, PaintBrushFlatIcon, TextFontIcon, LayoutBlockIcon, DiscountIcon, ImageIcon } from '@shopify/polaris-icons';
import PackPreview from './PackPreview';
import usePackDraft, { draftKey } from './usePackDraft';
import { formatMoney } from '../../utils/currency.shared';
import {
  CUSTOMIZATION_SCHEMA, PACK_TYPES, PACK_DESIGNS, MAX_TIERS, applyDesign, calculateTier, defaultCustomization, mergeCustomization, normalizeTiers, sanitizeCustomization, validateTiers, validateVariantCoverage,
} from '../../utils/packs.shared.js';

const PREVIEW_ZOOM = 0.8;
const STEPS = ['Product', 'Pack type', 'Configure', 'Design', 'Customize', 'Review'];
const STEP_KEYS = ['product', 'type', 'configure', 'design', 'customize', 'review'];
const REVIEW_STEP = STEPS.length - 1;

// Mock offers used only for the miniature design previews.
const SAMPLE_TIERS = [
  { quantity: 1, name: 'Buy 1', badge: '', savings: 0, subtotal: 40, price: 40 },
  { quantity: 2, name: 'Buy 2', badge: 'Popular', savings: 8, subtotal: 80, price: 72 },
  { quantity: 3, name: 'Buy 3', badge: '', savings: 18, subtotal: 120, price: 102 },
];

const blankTier = (quantity, discountType = 'none', discountValue = '') => ({ name: '', quantity: String(quantity), discountType, discountValue: String(discountValue), badge: '' });
const DEFAULT_TIERS = [blankTier(1), blankTier(2, 'percentage', 5), blankTier(3, 'percentage', 10)];

function emptyForm() {
  return {
    productId: '', productTitle: '', productImage: '', template: 'same_variant', packType: 'same_variant', variantScope: 'all', allowedVariantIds: [],
    tiers: DEFAULT_TIERS.map((tier) => ({ ...tier })), customization: defaultCustomization(),
  };
}

function packToForm(pack) {
  return {
    productId: pack.productId, productTitle: pack.productTitle, productImage: pack.productImage || '', template: pack.template,
    packType: pack.packType || (pack.template === 'choose_each_item' ? 'mix_match' : 'same_variant'),
    variantScope: pack.variantScope || 'selected',
    allowedVariantIds: pack.variantScope === 'all' ? [] : pack.allowedVariantIds || [pack.variantId],
    tiers: pack.tiers.map((tier) => ({ name: tier.name || '', quantity: String(tier.quantity), discountType: tier.discountType || 'none', discountValue: tier.discountType === 'none' ? '' : String(tier.discountValue ?? ''), badge: tier.badge || '' })),
    customization: mergeCustomization(pack.customization),
  };
}

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw Object.assign(new Error('Could not reach the server. Check your connection and try again.'), { code: 'network_error' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.success === false) {
    throw Object.assign(new Error(data?.error || 'The server returned an unexpected response. Please try again.'), { code: data?.code, details: data?.details });
  }
  return data;
}

function ColorField({ label, value, onChange, error }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="pz-color">
      <label className="pz-swatch" style={{ background: /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#fff' }}>
        <input type="color" aria-label={`${label} picker`} value={valid ? value : '#000000'} onChange={(event) => onChange(event.target.value)} />
      </label>
      <span className="pz-color-label">{label}</span>
      <div className="pz-hex">
        <TextField label={label} labelHidden value={value} onChange={onChange} autoComplete="off" error={error} monospaced size="slim" />
      </div>
    </div>
  );
}

function Toggle({ label, helpText, checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="pz-toggle" onClick={() => onChange(!checked)}>
      <span style={{ minWidth: 0 }}>
        <span className="pz-toggle-label">{label}</span>
        {helpText && <span className="pz-toggle-help">{helpText}</span>}
      </span>
      <span className={`pz-switch${checked ? ' pz-switch--on' : ''}`} aria-hidden="true"><span /></span>
    </button>
  );
}

function Segmented({ label, options, value, onChange, disabled }) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <Text as="span" variant="bodyMd">{label}</Text>
      <div className="pc-seg" role="group" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button key={String(optionValue)} type="button" disabled={disabled} aria-pressed={value === optionValue} onClick={() => onChange(optionValue)}>{optionLabel}</button>
        ))}
      </div>
    </div>
  );
}

function FieldGroup({ title, children }) {
  return (
    <div className="pz-group">
      <div className="pz-group-title">{title}</div>
      <BlockStack gap="300">{children}</BlockStack>
    </div>
  );
}

export default function PackBuilder({ mode, pack, currency, planState, shop, initialStep = 0 }) {
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const isEdit = mode === 'edit';
  const initialForm = useMemo(() => (pack ? packToForm(pack) : emptyForm()), [pack]);
  const [form, setForm] = useState(initialForm);
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEPS.length - 1));
  const [packId, setPackId] = useState(pack?.id || null);
  const [productData, setProductData] = useState({ status: 'idle', product: null, error: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [review, setReview] = useState({ status: 'idle', data: null, error: '' });
  const [reviewKey, setReviewKey] = useState(0);
  const [error, setError] = useState(null); // { message, code, details }
  const [saving, setSaving] = useState(null); // 'draft' | 'active' | 'keep' | null
  const [notice, setNotice] = useState('');
  const [previewViewport, setPreviewViewport] = useState('desktop'); // 'desktop' | 'mobile'
  const [customizeTab, setCustomizeTab] = useState('content');
  const [justChanged, setJustChanged] = useState(false);

  // The preview sits apart from the fields, so a single edit can be easy to
  // miss in it — flash a highlight ring around the whole preview every time
  // customization actually changes, so it's obvious what just moved.
  useEffect(() => {
    setJustChanged(true);
    const timer = setTimeout(() => setJustChanged(false), 900);
    return () => clearTimeout(timer);
  }, [form.customization, form.template]);

  const fmt = useCallback((value) => formatMoney(value, { currencyCode: currency.code, locale: currency.locale }), [currency.code, currency.locale]);
  const draft = usePackDraft(draftKey(shop, packId || pack?.id), form, initialForm, pack?.updatedAt ? new Date(pack.updatedAt).getTime() : null);

  // ── product data (always fetched fresh from the server) ────────────────────
  useEffect(() => {
    if (!form.productId) { setProductData({ status: 'idle', product: null, error: '' }); return undefined; }
    let cancelled = false;
    setProductData((current) => ({ status: 'loading', product: current.product?.id === form.productId ? current.product : null, error: '' }));
    api(`/api/packs?product=${encodeURIComponent(form.productId)}`)
      .then((data) => {
        if (cancelled) return;
        setProductData({ status: 'ready', product: data.product, error: '' });
        setForm((current) => {
          if (current.productId !== data.product.id) return current;
          // Drop any previously-selected variant that no longer exists on the
          // product (e.g. deleted in Shopify since this Pack was last saved).
          const liveIds = new Set(data.product.variants.map((variant) => variant.id));
          const allowedVariantIds = current.allowedVariantIds.filter((id) => liveIds.has(id));
          return { ...current, productTitle: data.product.title, productImage: data.product.image, allowedVariantIds };
        });
      })
      .catch((loadError) => { if (!cancelled) setProductData({ status: 'error', product: null, error: loadError.message }); });
    return () => { cancelled = true; };
  }, [form.productId, reloadKey]);

  const variants = productData.product?.variants || [];
  // The variants this Pack actually applies to: every variant ('all'), or the
  // merchant-curated subset ('selected'). Base pricing previews off the first
  // one — the real storefront always prices off whichever variant the shopper
  // has selected (see packs_widget.js / PackPreview's variant switcher).
  const applicableVariants = form.variantScope === 'all' ? variants : variants.filter((variant) => form.allowedVariantIds.includes(variant.id));
  const anchorVariant = applicableVariants[0] || null;
  const basePrice = anchorVariant?.price ?? null;

  const coverageCheck = useMemo(
    () => (productData.status === 'ready' ? validateVariantCoverage({ packType: form.packType, variantScope: form.variantScope, allowedVariantIds: form.allowedVariantIds }, variants.map((variant) => variant.id)) : { valid: false, errors: [{ field: 'variantScope', message: 'Loading product variants…' }] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productData.status, form.packType, form.variantScope, form.allowedVariantIds, variants.length]
  );
  const tierCheck = useMemo(() => validateTiers(form.tiers, { basePrice, currencyCode: currency.code }), [form.tiers, basePrice, currency.code]);
  const customCheck = useMemo(() => sanitizeCustomization(form.customization), [form.customization]);
  const tierErrors = (index, field) => tierCheck.errors.find((item) => item.index === index && item.field === field)?.message;

  const previewTiers = useMemo(() => {
    if (basePrice === null || !tierCheck.valid) return [];
    return normalizeTiers(form.tiers).map((tier) => ({ ...tier, ...calculateTier(basePrice, tier, { currencyCode: currency.code, locale: currency.locale }) }));
  }, [form.tiers, basePrice, tierCheck.valid, currency.code, currency.locale]);

  const update = (patch) => setForm((current) => ({ ...current, ...patch }));
  const updateTier = (index, patch) => setForm((current) => ({ ...current, tiers: current.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) }));
  const updateCustom = (group, key, value) => setForm((current) => ({ ...current, customization: { ...current.customization, [group]: { ...current.customization[group], [key]: value } } }));
  const sortTiers = () => setForm((current) => ({ ...current, tiers: [...current.tiers].sort((a, b) => (Number(a.quantity) || Infinity) - (Number(b.quantity) || Infinity)) }));
  const toggleVariant = (variantId) => setForm((current) => ({ ...current, allowedVariantIds: current.allowedVariantIds.includes(variantId) ? current.allowedVariantIds.filter((id) => id !== variantId) : [...current.allowedVariantIds, variantId] }));

  // ── step gating ────────────────────────────────────────────────────────────
  const blocker = (target) => {
    if (target > 0 && !form.productId) return 'Choose a Shopify product first.';
    if (target > 2 && !coverageCheck.valid) return `Fix variant coverage first: ${coverageCheck.errors[0]?.message}`;
    if (target > 2 && !tierCheck.valid) return `Fix the Pack tiers first: ${tierCheck.errors[0]?.message}`;
    if (target > 4 && customCheck.errors.length > 0) return `Fix the customization first: ${customCheck.errors[0]}`;
    return null;
  };
  const goTo = (target) => {
    const reason = blocker(target);
    if (reason && target > step) { setError({ message: reason }); return; }
    setError(null);
    setStep(target);
  };

  // ── review: server-side calculation ────────────────────────────────────────
  // Priced against the anchor variant only — an illustrative preview; the
  // storefront always prices off whichever variant the shopper actually has
  // selected (see displayedTier in packs_widget.js).
  useEffect(() => {
    if (step !== REVIEW_STEP || !form.productId || !anchorVariant) return undefined;
    let cancelled = false;
    setReview({ status: 'loading', data: null, error: '' });
    api('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', productId: form.productId, variantId: anchorVariant.id, tiers: form.tiers }) })
      .then((data) => { if (!cancelled) setReview({ status: 'ready', data, error: '' }); })
      .catch((loadError) => { if (!cancelled) setReview({ status: 'error', data: null, error: loadError.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, reviewKey]);

  // ── actions ────────────────────────────────────────────────────────────────
  async function chooseProduct() {
    setError(null);
    try {
      const result = await shopify.resourcePicker({ type: 'product', multiple: false, action: 'select' });
      const selected = result?.[0];
      if (!selected?.id) return;
      const numeric = String(selected.id).split('/').pop();
      if (numeric === form.productId) return;
      update({ productId: numeric, productTitle: selected.title || '', productImage: selected.images?.[0]?.originalSrc || '', variantScope: 'all', allowedVariantIds: [] });
    } catch {
      setError({ message: 'Could not open the Shopify product picker. Please try again.' });
    }
  }

  async function save(status) {
    setError(null);
    setNotice('');
    setSaving(status);
    try {
      const data = await api('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: packId, productId: form.productId, packType: form.packType, variantScope: form.variantScope, allowedVariantIds: form.allowedVariantIds, template: form.template, tiers: form.tiers, customization: form.customization, status }) });
      draft.clearKey(draftKey(shop, 'new'));
      draft.markSaved(form);
      setPackId(data.pack.id);
      navigate(`/app/packs/${data.pack.id}`, { replace: true, state: { saved: true, warning: data.warning?.message || null, checkoutDiscount: data.checkoutDiscount || null } });
    } catch (saveError) {
      setError({ message: saveError.message, code: saveError.code, details: saveError.details });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(null);
    }
  }

  function leave() {
    if (draft.dirty && !window.confirm('You have unsaved Pack changes. Leave without saving?')) return;
    navigate(isEdit ? `/app/packs/${pack.id}` : '/app/packs');
  }

  function restoreDraft() {
    const stored = draft.takeDraft();
    if (!stored) return;
    setForm({ ...emptyForm(), ...stored.form, customization: mergeCustomization(stored.form.customization) });
    setNotice('Draft restored. It stays local to this browser until you save the Pack.');
  }

  // ── step content ───────────────────────────────────────────────────────────
  const checkSvg = (size = 11, color = '#fff') => (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  const productStep = (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Select product</Text>
              <Text as="p" tone="subdued">Choose the Shopify product this Pack applies to. You&apos;ll choose which variants it covers next — price and stock are always read live from Shopify.</Text>
            </BlockStack>
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={chooseProduct}>{form.productId ? 'Change product' : 'Choose product'}</Button>
              {isEdit && form.productId && <Text as="span" tone="subdued" variant="bodySm">Changing the product changes which storefront page shows this Pack.</Text>}
            </InlineStack>
            {productData.status === 'loading' && <BlockStack gap="200"><InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span" tone="subdued">Loading product from Shopify…</Text></InlineStack><SkeletonBodyText lines={2} /></BlockStack>}
            {productData.status === 'error' && <Banner tone="critical" title="Could not load this product" action={{ content: 'Retry', onAction: () => setReloadKey((key) => key + 1) }}><p>{productData.error}</p></Banner>}
            {productData.status === 'ready' && (
              <Box background="bg-surface-secondary" padding="400" borderRadius="300">
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    {productData.product.image ? <Thumbnail source={productData.product.image} alt="" size="large" /> : <div style={{ width: 60, height: 60, borderRadius: 10, background: '#e3e5e8', flexShrink: 0 }} />}
                    <BlockStack gap="100">
                      <Text as="span" variant="headingSm">{productData.product.title}</Text>
                      <Text as="span" tone="subdued" variant="bodySm">{variants.length} variant{variants.length === 1 ? '' : 's'}</Text>
                      {productData.product.status !== 'ACTIVE' && <Badge tone="warning">{`Product is ${productData.product.status.toLowerCase()}`}</Badge>}
                    </BlockStack>
                  </InlineStack>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {variants.map((variant) => (
                      <span key={variant.id} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: variant.availableForSale ? '#f3f4f6' : '#fbe9e9', color: variant.availableForSale ? '#3b3f45' : '#a11919' }}>
                        {variant.title} — {fmt(variant.price)}{variant.availableForSale ? '' : ' · out of stock'}
                      </span>
                    ))}
                  </div>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Checklist</Text>
              <Badge tone={form.productId ? 'success' : 'info'}>{`${form.productId ? 1 : 0} of 1 done`}</Badge>
            </InlineStack>
            <div style={{ height: 6, borderRadius: 999, background: '#e3e5e8', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${form.productId ? 100 : 0}%`, background: '#008060', borderRadius: 999, transition: 'width .2s ease' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {form.productId ? <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, margin: 0, background: '#008060', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{checkSvg()}</span> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #c9cccf', flexShrink: 0 }} />}
                <Text as="span" tone={form.productId ? 'success' : 'subdued'} fontWeight={form.productId ? 'medium' : 'regular'}>Product selected</Text>
              </div>
              <div style={{ paddingLeft: 28 }}>
                <Text as="span" variant="bodySm" tone="subdued">{form.productId ? (productData.product?.title || form.productTitle) : 'Pick the Shopify product this Pack applies to.'}</Text>
              </div>
            </div>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const currentType = PACK_TYPES.find((type) => type.id === form.packType) || PACK_TYPES[0];
  const typeStep = (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Pack type</Text>
          <Text as="p" tone="subdued">Both types apply to variants of the same Shopify product. This only changes how shoppers build their Pack.</Text>
        </BlockStack>
        <div role="radiogroup" aria-label="Pack type" style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {PACK_TYPES.map((type) => {
            const selected = currentType.id === type.id;
            const sample = type.id === 'same_variant' ? ['Black / M', 'Black / M', 'Black / M'] : ['Black / M', 'White / S', 'Grey / L'];
            return (
              <button key={type.id} type="button" role="radio" aria-checked={selected} onClick={() => { if (!selected) update({ packType: type.id, template: type.defaultTemplate }); }}
                style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', background: selected ? '#f3f3f3' : '#fff', border: `2px solid ${selected ? '#111111' : '#e3e5e8'}`, borderRadius: 14, padding: 24 }}>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center"><Text as="span" variant="headingMd">{type.name}</Text>{selected && <Badge>Selected</Badge>}</InlineStack>
                  <Text as="p" tone="subdued">{type.description}</Text>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sample.map((label, index) => (
                      <span key={index} style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: selected ? '#e8e8e8' : '#f3f4f6', color: '#303030' }}>{index + 1} · {label}</span>
                    ))}
                  </div>
                  <Text as="span" variant="bodySm" tone="subdued">Example: {type.example}</Text>
                </BlockStack>
              </button>
            );
          })}
        </div>
      </BlockStack>
    </Card>
  );

  // Picking a layout only changes structure (and the shape/spacing that suits
  // it) — the merchant's colors are carried over, so switching never repaints.
  const withLayout = (designId) => ({ ...applyDesign(form.customization, designId), colors: form.customization.colors });
  const chooseLayout = (designId) => update({ customization: withLayout(designId), template: form.template === 'visual_offer' ? 'same_variant' : form.template });
  const designStep = (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Choose a layout</Text>
          <Text as="p" tone="subdued">Each layout arranges your offers differently. Your colors stay the same, and you can fine-tune everything in the next step.</Text>
        </BlockStack>
        <div role="radiogroup" aria-label="Pack layout" className="pd-grid">
          {PACK_DESIGNS.map((design) => {
            const selected = form.customization.design.preset === design.id;
            const styled = withLayout(design.id);
            const thumb = { ...styled, images: { ...styled.images, enabled: false }, content: { ...styled.content, promoText: '' } };
            return (
              <button key={design.id} type="button" role="radio" aria-checked={selected} aria-label={design.name} onClick={() => chooseLayout(design.id)} className={`pd-card${selected ? ' pd-card--on' : ''}`}>
                <div className="pd-stage" aria-hidden="true">
                  <div style={{ zoom: 0.62, width: '100%', pointerEvents: 'none' }}>
                    <PackPreview template={form.template === 'choose_each_item' ? 'same_variant' : form.template} customization={thumb} tiers={SAMPLE_TIERS} productImage={form.productImage} formatMoney={fmt} />
                  </div>
                </div>
                <div className="pd-meta">
                  <span className={`pd-radio${selected ? ' pd-radio--on' : ''}`} aria-hidden="true">{selected && checkSvg(10)}</span>
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold">{design.name}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{design.description}</Text>
                  </BlockStack>
                </div>
              </button>
            );
          })}
        </div>
      </BlockStack>
    </Card>
  );

  // ── Configure step: variant coverage + tier ladder on the left, a sticky
  // live pricing summary on the right so the merchant always sees what each
  // tier will actually cost while editing it.
  const builderStyles = (
    <style>{`
.pc-options{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.pc-option{display:flex;gap:12px;align-items:flex-start;text-align:left;font:inherit;cursor:pointer;padding:16px;border:1.5px solid #e3e5e8;border-radius:12px;background:#fff;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}
.pc-option:hover{border-color:#9a9a9a}
.pc-option--on{border-color:#111111;background:#f3f3f3;box-shadow:0 4px 14px rgba(17,17,17,.12)}
.pc-radio{width:18px;height:18px;border-radius:50%;border:2px solid #c9cccf;flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;background:#fff}
.pc-option--on .pc-radio{border-color:#111111}
.pc-option--on .pc-radio::after{content:'';width:8px;height:8px;border-radius:50%;background:#111111}
.pc-variants{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
.pc-variant{display:flex;align-items:center;gap:10px;text-align:left;font:inherit;cursor:pointer;padding:10px 12px;border:1.5px solid #e3e5e8;border-radius:10px;background:#fff;transition:border-color .15s ease,background .15s ease}
.pc-variant:hover{border-color:#9a9a9a}
.pc-variant--on{border-color:#111111;background:#f3f3f3}
.pc-check{width:18px;height:18px;border-radius:5px;border:2px solid #c9cccf;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#fff}
.pc-variant--on .pc-check{border-color:#111111;background:#111111}
.pc-tier{border:1px solid #e3e5e8;border-radius:14px;background:#fff;overflow:hidden;transition:border-color .15s ease}
.pc-tier--error{border-color:#e4a5a0}
.pc-tier-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:#fafafb;border-bottom:1px solid #eef0f2}
.pc-tier-num{width:30px;height:30px;border-radius:50%;background:#111111;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pc-tier-body{padding:16px;display:flex;flex-direction:column;gap:14px}
.pc-row{display:grid;gap:12px;grid-template-columns:110px minmax(0,1fr) 150px;align-items:start}
.pc-row2{display:grid;gap:12px;grid-template-columns:1fr 1fr}
.pc-seg{display:flex;border:1px solid #c9cccf;border-radius:8px;overflow:hidden;margin-top:4px;height:36px}
.pc-seg button{flex:1;font:inherit;font-size:13px;font-weight:500;border:0;border-right:1px solid #e3e5e8;background:#fff;color:#3b3f45;cursor:pointer;padding:0 8px;white-space:nowrap;transition:background .15s ease,color .15s ease}
.pc-seg button:last-child{border-right:0}
.pc-seg button:hover{background:#f6f6f7}
.pc-seg button[aria-pressed=true]{background:#111111;color:#fff}
.pc-price{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:10px;background:#f6f6f7;border:1px solid #e6e6e6}
.pc-pill{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.pc-pill--save{background:#e3f5ec;color:#0c6b44}
.pc-pill--badge{background:#111111;color:#fff}
.pc-pill--muted{background:#f1f2f4;color:#6d7175}
.pc-add{width:100%;display:flex;align-items:center;justify-content:center;gap:6px;font:inherit;font-size:14px;font-weight:600;color:#111111;background:#fff;border:1.5px dashed #b5b5b5;border-radius:12px;padding:14px;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.pc-add:hover:not(:disabled){background:#f3f3f3;border-color:#111111}
.pc-add:disabled{color:#a3a7ad;border-color:#e3e5e8;cursor:not-allowed}
.pc-ladder{display:flex;flex-direction:column;gap:8px}
.pc-ladder-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;background:#fafafb;border:1px solid #eef0f2}
.pz-nav{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.pz-nav-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;font:inherit;font-size:12px;font-weight:600;color:#4a4f55;background:#fafafb;border:1.5px solid #eceef0;border-radius:12px;padding:12px 6px;cursor:pointer;transition:background .15s ease,border-color .15s ease,color .15s ease}
.pz-nav-item:hover{border-color:#9a9a9a;background:#fff}
.pz-nav-item--on{background:#f3f3f3;border-color:#111111;color:#111111}
.pz-nav-icon{width:20px;height:20px;display:inline-flex}
.pz-nav-error{position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:#d82c0d}
.pz-panel-head{padding-bottom:12px;border-bottom:1px solid #eef0f2;display:flex;flex-direction:column;gap:2px}
.pz-group{display:flex;flex-direction:column;gap:10px}
.pz-group-title{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a8f97}
.pz-colors{display:flex;flex-direction:column;border:1px solid #eceef0;border-radius:10px;overflow:hidden}
.pz-color{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fff;border-bottom:1px solid #f1f2f4}
.pz-color:last-child{border-bottom:0}
.pz-swatch{position:relative;width:28px;height:28px;border-radius:8px;border:1px solid rgba(0,0,0,.14);box-shadow:inset 0 0 0 2px #fff;flex-shrink:0;cursor:pointer;overflow:hidden}
.pz-swatch input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}
.pz-color-label{flex:1;min-width:0;font-size:13px;color:#303030}
.pz-hex{width:104px;flex-shrink:0}
.pz-slider-value{display:inline-block;min-width:40px;text-align:right;font-size:12px;font-weight:600;color:#4a4f55;font-variant-numeric:tabular-nums}
.pz-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;font:inherit;background:#fafafb;border:1px solid #eceef0;border-radius:10px;padding:12px 14px;cursor:pointer}
.pz-toggle:hover{border-color:#c9c9c9}
.pz-toggle-label{display:block;font-size:13px;font-weight:600;color:#303030}
.pz-toggle-help{display:block;font-size:12px;color:#6d7175;margin-top:2px}
.pz-switch{position:relative;width:38px;height:22px;border-radius:999px;background:#c9cccf;flex-shrink:0;transition:background .15s ease}
.pz-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}
.pz-switch--on{background:#111111}
.pz-switch--on span{transform:translateX(16px)}
.pc-seg button:disabled{cursor:not-allowed}
.pd-grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.pd-card{display:flex;flex-direction:column;text-align:left;font:inherit;cursor:pointer;background:#fff;border:2px solid #e3e5e8;border-radius:16px;padding:0;overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.pd-card:hover{border-color:#9a9a9a;transform:translateY(-2px);box-shadow:0 8px 22px rgba(15,23,42,.08)}
.pd-card--on,.pd-card--on:hover{border-color:#111111;box-shadow:0 8px 24px rgba(17,17,17,.18)}
.pd-stage{height:250px;overflow:hidden;padding:18px;background:linear-gradient(180deg,#f7f7f8 0%,#eef0f3 100%);border-bottom:1px solid #eceef0;display:flex;align-items:flex-start}
.pd-card--on .pd-stage{background:linear-gradient(180deg,#f7f7f7 0%,#ececec 100%)}
.pd-meta{display:flex;gap:12px;align-items:flex-start;padding:14px 16px}
.pd-radio{width:20px;height:20px;border-radius:50%;border:2px solid #c9cccf;flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center}
.pd-radio--on{border-color:#111111;background:#111111}
@media (max-width: 640px){.pc-row{grid-template-columns:1fr}.pc-row2{grid-template-columns:1fr}}
    `}</style>
  );

  const coverageSelected = form.variantScope === 'selected';
  const coverageError = coverageCheck.errors.find((item) => item.field === 'allowedVariantIds');
  const coverageStep = (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">Variant coverage</Text>
            {productData.status === 'ready' && <Badge tone={coverageCheck.valid ? 'success' : 'critical'}>{form.variantScope === 'all' ? `All ${variants.length}` : `${form.allowedVariantIds.length} of ${variants.length}`}</Badge>}
          </InlineStack>
          <Text as="p" tone="subdued">{currentType.id === 'mix_match' ? 'Which variants can customers choose from when building their Pack?' : "Choose which of this product's variants this Pack applies to. Shoppers see the Pack whenever one of these is selected."}</Text>
        </BlockStack>
        {productData.status === 'loading' && <InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span" tone="subdued">Loading variants…</Text></InlineStack>}
        {productData.status !== 'ready' && productData.status !== 'loading' && <Text as="p" tone="subdued" variant="bodySm">Pick a product first.</Text>}
        {productData.status === 'ready' && (
          <>
            <div role="radiogroup" aria-label="Apply Pack to" className="pc-options">
              {[
                ['all', 'All variants', `Every variant of this product (${variants.length}), including ones you add later.`],
                ['selected', 'Selected variants', currentType.id === 'mix_match' ? 'Choose exactly which variants customers can combine.' : 'Choose exactly which variants this Pack applies to.'],
              ].map(([value, label, help]) => {
                const on = form.variantScope === value;
                return (
                  <button key={value} type="button" role="radio" aria-checked={on} className={`pc-option${on ? ' pc-option--on' : ''}`} onClick={() => update({ variantScope: value })}>
                    <span className="pc-radio" aria-hidden="true" />
                    <BlockStack gap="050"><Text as="span" fontWeight="semibold">{label}</Text><Text as="span" variant="bodySm" tone="subdued">{help}</Text></BlockStack>
                  </button>
                );
              })}
            </div>
            {coverageSelected && (
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">{form.allowedVariantIds.length} of {variants.length} selected</Text>
                  <Button variant="plain" onClick={() => update({ allowedVariantIds: form.allowedVariantIds.length === variants.length ? [] : variants.map((variant) => variant.id) })}>
                    {form.allowedVariantIds.length === variants.length ? 'Deselect all' : 'Select all'}
                  </Button>
                </InlineStack>
                <div className="pc-variants">
                  {variants.map((variant) => {
                    const on = form.allowedVariantIds.includes(variant.id);
                    return (
                      <button key={variant.id} type="button" role="checkbox" aria-checked={on} className={`pc-variant${on ? ' pc-variant--on' : ''}`} onClick={() => toggleVariant(variant.id)}>
                        <span className="pc-check" aria-hidden="true">{on && checkSvg(10)}</span>
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#303030', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variant.title}</span>
                          <span style={{ display: 'block', fontSize: 12, color: variant.availableForSale ? '#6d7175' : '#a11919' }}>{fmt(variant.price)}{variant.availableForSale ? '' : ' · out of stock'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {coverageError && <Banner tone="critical"><p>{coverageError.message}</p></Banner>}
              </BlockStack>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );

  const addTier = () => { const last = Math.max(0, ...form.tiers.map((tier) => Number(tier.quantity) || 0)); setForm((current) => ({ ...current, tiers: [...current.tiers, blankTier(last + 1)] })); };
  const discountOptions = [['none', 'None'], ['percentage', '% off'], ['fixed', 'Amount off']];
  const savingsPercent = (calc) => (calc && calc.subtotal > 0 ? Math.round((calc.savings / calc.subtotal) * 100) : 0);

  const tiersCard = (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">Pack tiers</Text>
            <Badge>{`${form.tiers.length} of ${MAX_TIERS}`}</Badge>
          </InlineStack>
          <Text as="p" tone="subdued">
            {currentType.id === 'mix_match'
              ? 'Each tier is a Pack size — shoppers combine that many variants from the list above (repeats allowed).'
              : 'Each tier is a quantity of the selected variant sold at a set discount. Prices update automatically per variant on your storefront.'}
          </Text>
        </BlockStack>
        {tierCheck.errors.filter((item) => item.index === null).map((item) => <Banner key={item.message} tone="critical"><p>{item.message}</p></Banner>)}
        {form.tiers.map((tier, index) => {
          const valid = !tierCheck.errors.some((item) => item.index === index);
          const calc = valid && basePrice !== null ? calculateTier(basePrice, { quantity: Number(tier.quantity), discountType: tier.discountType, discountValue: Number(tier.discountValue) }, { currencyCode: currency.code, locale: currency.locale }) : null;
          const pct = savingsPercent(calc);
          return (
            <div key={index} className={`pc-tier${valid ? '' : ' pc-tier--error'}`}>
              <div className="pc-tier-head">
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <span className="pc-tier-num" aria-hidden="true">{index + 1}</span>
                  <BlockStack gap="0">
                    <Text as="h3" variant="headingSm">{tier.name.trim() || `Buy ${Number(tier.quantity) || '—'}`}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">Tier {index + 1} · {Number(tier.quantity) || 0} item{Number(tier.quantity) === 1 ? '' : 's'}</Text>
                  </BlockStack>
                  {tier.badge.trim() && <span className="pc-pill pc-pill--badge">{tier.badge.trim()}</span>}
                </InlineStack>
                <Button variant="tertiary" tone="critical" icon={DeleteIcon} disabled={form.tiers.length <= 1} onClick={() => setForm((current) => ({ ...current, tiers: current.tiers.filter((_, i) => i !== index) }))} accessibilityLabel={`Remove tier ${index + 1}`} />
              </div>
              <div className="pc-tier-body">
                <div className="pc-row">
                  <TextField label="Quantity" type="number" min={1} max={100} value={tier.quantity} onChange={(value) => updateTier(index, { quantity: value })} onBlur={sortTiers} autoComplete="off" error={tierErrors(index, 'quantity')} />
                  <div>
                    <Text as="span" variant="bodyMd">Discount</Text>
                    <div className="pc-seg" role="group" aria-label={`Tier ${index + 1} discount type`}>
                      {discountOptions.map(([value, label]) => (
                        <button key={value} type="button" aria-pressed={tier.discountType === value} onClick={() => updateTier(index, { discountType: value, discountValue: value === 'none' ? '' : tier.discountValue })}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <TextField label="Value" type="number" min={0} disabled={tier.discountType === 'none'} value={tier.discountValue} onChange={(value) => updateTier(index, { discountValue: value })} suffix={tier.discountType === 'percentage' ? '%' : tier.discountType === 'fixed' ? currency.code : undefined} placeholder={tier.discountType === 'none' ? '—' : '0'} autoComplete="off" error={tierErrors(index, 'discountValue')} />
                </div>
                <div className="pc-row2">
                  <TextField label="Display name" value={tier.name} maxLength={60} onChange={(value) => updateTier(index, { name: value })} placeholder={`Buy ${Number(tier.quantity) || ''}`.trim()} helpText="Optional" autoComplete="off" error={tierErrors(index, 'name')} />
                  <TextField label="Badge" value={tier.badge} maxLength={24} onChange={(value) => updateTier(index, { badge: value })} placeholder="e.g. Best value" helpText="Optional" autoComplete="off" error={tierErrors(index, 'badge')} />
                </div>
                {calc ? (
                  <div className="pc-price">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Pack price</Text>
                      <InlineStack gap="200" blockAlign="baseline">
                        <Text as="span" variant="headingLg">{calc.formatted.price}</Text>
                        {calc.savings > 0 && <span style={{ fontSize: 13, color: '#8a8f97', textDecoration: 'line-through' }}>{calc.formatted.subtotal}</span>}
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <span className="pc-pill pc-pill--muted">{calc.formatted.effectiveUnitPrice} / item</span>
                      {calc.savings > 0 ? <span className="pc-pill pc-pill--save">Save {calc.formatted.savings}{pct > 0 ? ` (${pct}%)` : ''}</span> : <span className="pc-pill pc-pill--muted">Full price</span>}
                    </InlineStack>
                  </div>
                ) : <Text as="p" tone="subdued" variant="bodySm">{basePrice === null ? 'Choose variant coverage above to preview prices.' : 'Fix the highlighted fields to preview this tier’s price.'}</Text>}
              </div>
            </div>
          );
        })}
        <button type="button" className="pc-add" disabled={form.tiers.length >= MAX_TIERS} onClick={addTier}>
          <span style={{ width: 18, height: 18, display: 'inline-flex' }}><Icon source={PlusIcon} tone="inherit" /></span>
          {form.tiers.length >= MAX_TIERS ? `Maximum of ${MAX_TIERS} tiers reached` : 'Add tier'}
        </button>
      </BlockStack>
    </Card>
  );

  const pricingSummary = (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h3" variant="headingSm">Pricing summary</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Previewed with “{anchorVariant ? anchorVariant.title : 'the first variant'}” at {basePrice === null ? '—' : fmt(basePrice)} each.
          </Text>
        </BlockStack>
        {previewTiers.length > 0 ? (
          <div className="pc-ladder">
            {previewTiers.map((tier) => {
              const pct = savingsPercent(tier);
              return (
                <div key={tier.quantity} className="pc-ladder-row">
                  <BlockStack gap="0">
                    <InlineStack gap="150" blockAlign="center">
                      <Text as="span" fontWeight="semibold">{tier.name || `Buy ${tier.quantity}`}</Text>
                      {tier.badge && <span className="pc-pill pc-pill--badge" style={{ fontSize: 10, padding: '1px 7px' }}>{tier.badge}</span>}
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">{tier.formatted.effectiveUnitPrice} / item</Text>
                  </BlockStack>
                  <BlockStack gap="050" inlineAlign="end">
                    <Text as="span" fontWeight="bold">{tier.formatted.price}</Text>
                    {pct > 0 ? <span className="pc-pill pc-pill--save" style={{ fontSize: 11, padding: '1px 8px' }}>−{pct}%</span> : <Text as="span" variant="bodySm" tone="subdued">No discount</Text>}
                  </BlockStack>
                </div>
              );
            })}
          </div>
        ) : (
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <Text as="p" variant="bodySm" tone="subdued">{basePrice === null ? 'Choose variant coverage to see prices.' : 'Fix the highlighted tier fields to see the full pricing ladder.'}</Text>
          </Box>
        )}
        <Divider />
        <Text as="p" variant="bodySm" tone="subdued">Tip: a “Popular” or “Best value” badge on your middle or top tier nudges shoppers toward the bigger Pack. Final prices always come from Shopify at checkout.</Text>
      </BlockStack>
    </Card>
  );

  const configureStep = (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {coverageStep}
          {tiersCard}
        </BlockStack>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <div className="pb-scroll-pane">{pricingSummary}</div>
      </Layout.Section>
    </Layout>
  );

  const contentField = (key, label, maxLength, helpText) => <TextField label={label} value={form.customization.content[key]} maxLength={maxLength} showCharacterCount helpText={helpText} onChange={(value) => updateCustom('content', key, value)} autoComplete="off" />;
  // Sizes are sliders bounded by the same schema the server validates
  // against, so every position the merchant can drag to is a valid value.
  const sizeField = (group, key, label) => {
    const { min, max } = CUSTOMIZATION_SCHEMA[group][key];
    const current = Number(form.customization[group][key]);
    return (
      <RangeSlider
        label={label}
        min={min}
        max={max}
        value={Number.isFinite(current) ? current : min}
        onChange={(value) => updateCustom(group, key, Number(value))}
        suffix={<span className="pz-slider-value">{Number.isFinite(current) ? current : min}px</span>}
        error={customCheck.errors.find((message) => message.startsWith(`${group}.${key} `))}
      />
    );
  };
  const colorField = (key, label) => <ColorField key={key} label={label} value={form.customization.colors[key]} onChange={(value) => updateCustom('colors', key, value)} error={customCheck.errors.find((message) => message.startsWith(`colors.${key} `))} />;
  const capitalize = (value) => value[0].toUpperCase() + value.slice(1);

  // ── Customize step: one focused panel at a time. An icon grid at the top
  // (with an error dot per section) makes every section reachable in one
  // click, and Previous/Next at the bottom walks through them in order.
  const CUSTOMIZE_TABS = [
    { id: 'content', label: 'Content', icon: TextBlockIcon, description: 'The heading, subtext and button wording shoppers read.', prefixes: ['content.'] },
    { id: 'colors', label: 'Colors', icon: PaintBrushFlatIcon, description: 'Match the widget to your brand and theme.', prefixes: ['colors.'] },
    { id: 'typography', label: 'Typography', icon: TextFontIcon, description: 'Text sizes, weight and heading alignment.', prefixes: ['typography.'] },
    { id: 'layout', label: 'Layout', icon: LayoutBlockIcon, description: 'Corners, borders, shadow and spacing.', prefixes: ['borders.', 'spacing.'] },
    { id: 'savings', label: 'Savings', icon: DiscountIcon, description: 'How the discount is called out on each offer.', prefixes: ['savings.'] },
    { id: 'image', label: 'Image', icon: ImageIcon, description: 'Show the product photo inside each offer.', prefixes: ['images.'] },
  ];
  const tabHasError = (tab) => customCheck.errors.some((message) => tab.prefixes.some((prefix) => message.startsWith(prefix)));

  const previewNavLinks = ['Home', 'Shop', 'Collections', 'About'];
  const dot = (color) => <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />;

  // Shared mock product page used by both the Customize step's live preview and
  // the Review step's storefront preview, so a Pack always looks the same way
  // in both places instead of the Review step showing a bare, context-less widget.
  const storefrontPreviewCard = (tiersForPreview) => (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" wrap>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">Storefront preview</Text>
              <span aria-live="polite" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase', color: '#111111', background: '#f3f3f3', padding: '2px 8px', borderRadius: 999, opacity: justChanged ? 1 : 0, transition: 'opacity .25s ease' }}>
                Updated
              </span>
            </InlineStack>
            <Text as="span" variant="bodySm" tone="subdued">See how your Pack looks on the product page</Text>
          </BlockStack>
          <InlineStack gap="200" blockAlign="center">
            <Button variant="plain" onClick={() => update({ customization: applyDesign(form.customization, form.customization.design.preset) })}>Reset styling</Button>
            <ButtonGroup variant="segmented">
              <Button icon={DesktopIcon} pressed={previewViewport === 'desktop'} onClick={() => setPreviewViewport('desktop')}>Desktop</Button>
              <Button icon={MobileIcon} pressed={previewViewport === 'mobile'} onClick={() => setPreviewViewport('mobile')}>Mobile</Button>
            </ButtonGroup>
          </InlineStack>
        </InlineStack>
        <div style={{ background: '#f1f2f4', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          <div style={{
            // Rendered at 80% (zoom) so the whole mock page fits the column at a
            // glance; the width is scaled up to match so it still fills the space.
            zoom: PREVIEW_ZOOM, width: `${100 / PREVIEW_ZOOM}%`, maxWidth: previewViewport === 'mobile' ? 375 : 900, background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #e3e5e8',
            boxShadow: justChanged ? '0 0 0 3px rgba(17,17,17,.45), 0 8px 30px rgba(15,23,42,.12)' : '0 8px 30px rgba(15,23,42,.12)',
            transition: 'box-shadow .25s ease',
          }}>
            {previewViewport === 'desktop' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f6f6f7', borderBottom: '1px solid #e3e5e8' }}>
                {dot('#ff5f57')}{dot('#febc2e')}{dot('#28c840')}
                <div style={{ flex: 1, marginLeft: 10, padding: '5px 12px', background: '#fff', border: '1px solid #e3e5e8', borderRadius: 6, fontSize: 11, color: '#8a8f97' }}>yourstore.com</div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: previewViewport === 'mobile' ? '12px 16px' : '16px 28px', borderBottom: '1px solid #f0f0f0' }}>
              <Text as="span" fontWeight="bold">Your Store</Text>
              {previewViewport === 'desktop' && <InlineStack gap="400">{previewNavLinks.map((link) => <Text as="span" key={link} variant="bodySm" tone="subdued">{link}</Text>)}</InlineStack>}
              <InlineStack gap="300" blockAlign="center">
                <span style={{ width: 18, height: 18, display: 'inline-flex' }}><Icon source={SearchIcon} tone="subdued" /></span>
                <span style={{ width: 18, height: 18, display: 'inline-flex' }}><Icon source={PersonIcon} tone="subdued" /></span>
                <span style={{ width: 18, height: 18, display: 'inline-flex' }}><Icon source={CartIcon} tone="subdued" /></span>
              </InlineStack>
            </div>
            <div style={{ padding: previewViewport === 'mobile' ? 16 : 22, display: previewViewport === 'mobile' ? 'block' : 'grid', gridTemplateColumns: previewViewport === 'mobile' ? undefined : 'minmax(150px, 200px) 1fr', gap: 22 }}>
              <div style={{ maxWidth: previewViewport === 'mobile' ? 180 : 200, margin: previewViewport === 'mobile' ? '0 auto' : undefined }}>
                <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, background: '#f1f2f4', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {form.productImage ? <img src={form.productImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Text as="span" tone="subdued" variant="bodySm">Product image</Text>}
                </div>
                {previewViewport === 'desktop' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {[0, 1, 2, 3].map((i) => <div key={i} style={{ width: 40, height: 40, borderRadius: 6, background: '#f1f2f4', border: '1px solid #e3e5e8' }} />)}
                  </div>
                )}
              </div>
              <div style={{ marginTop: previewViewport === 'mobile' ? 16 : 0 }}>
                <Text as="h2" variant="headingMd">{form.productTitle || 'Product title'}</Text>
                <div style={{ margin: '6px 0 12px' }}>
                  <Text as="span" variant="headingSm">{basePrice === null ? '$0.00' : fmt(basePrice)}</Text>
                </div>
                <Text as="p" tone="subdued" variant="bodySm">A short product description goes here, giving shoppers context about this item before they see the Pack offer below.</Text>
                <div style={{ margin: '16px 0' }}>
                  <PackPreview template={form.template} packType={form.packType} variants={applicableVariants} customization={form.customization} tiers={tiersForPreview} productImage={form.productImage} formatMoney={fmt} compact={previewViewport === 'mobile'} />
                </div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #f0f0f0', padding: previewViewport === 'mobile' ? '14px 16px' : '16px 28px' }}>
              <Text as="span" fontWeight="medium">Product details</Text>
            </div>
          </div>
        </div>
        <Text as="p" variant="bodySm" tone="subdued">This mock product page shows how the Pack sits alongside your theme. Switch to Mobile to catch cramped layouts before you save. Final prices always come from Shopify at checkout.</Text>
      </BlockStack>
    </Card>
  );

  const customizeTabPanels = {
    content: (
      <BlockStack gap="400">
        <FieldGroup title="Header">
          {contentField('heading', 'Heading', 80, 'Shown above the Pack offers.')}
          {contentField('subheading', 'Subheading', 160)}
        </FieldGroup>
        <FieldGroup title="Call to action">
          {contentField('promoText', 'Promotional text', 160, 'Shown just above the button.')}
          {contentField('cta', 'Button label', 40)}
        </FieldGroup>
      </BlockStack>
    ),
    colors: (
      <BlockStack gap="400">
        <FieldGroup title="Widget & cards">
          <div className="pz-colors">{[['background', 'Widget background'], ['cardBackground', 'Card background'], ['selectedCard', 'Selected card'], ['border', 'Card border'], ['primary', 'Accent / selected border']].map(([key, label]) => colorField(key, label))}</div>
        </FieldGroup>
        <FieldGroup title="Text">
          <div className="pz-colors">{[['text', 'Text'], ['price', 'Price'], ['discount', 'Savings text']].map(([key, label]) => colorField(key, label))}</div>
        </FieldGroup>
        <FieldGroup title="Badge & button">
          <div className="pz-colors">{[['badge', 'Badge background'], ['button', 'Button'], ['buttonText', 'Button text']].map(([key, label]) => colorField(key, label))}</div>
        </FieldGroup>
      </BlockStack>
    ),
    typography: (
      <BlockStack gap="400">
        <FieldGroup title="Sizes">
          {sizeField('typography', 'headingSize', 'Heading')}
          {sizeField('typography', 'packTitleSize', 'Pack title')}
          {sizeField('typography', 'priceSize', 'Price')}
          {sizeField('typography', 'descriptionSize', 'Detail text')}
        </FieldGroup>
        <FieldGroup title="Style">
          <Segmented label="Font weight" options={[[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold']]} value={Number(form.customization.typography.fontWeight)} onChange={(value) => updateCustom('typography', 'fontWeight', value)} />
          <Segmented label="Heading alignment" options={['left', 'center', 'right'].map((value) => [value, capitalize(value)])} value={form.customization.typography.alignment} onChange={(value) => updateCustom('typography', 'alignment', value)} />
        </FieldGroup>
      </BlockStack>
    ),
    layout: (
      <BlockStack gap="400">
        <FieldGroup title="Border">
          {sizeField('borders', 'radius', 'Corner radius')}
          {sizeField('borders', 'width', 'Border width')}
          <Segmented label="Border style" options={['solid', 'dashed', 'dotted'].map((value) => [value, capitalize(value)])} value={form.customization.borders.style} onChange={(value) => updateCustom('borders', 'style', value)} />
          <Toggle label="Drop shadow" helpText="Adds a soft shadow under each offer card." checked={form.customization.borders.shadow} onChange={(value) => updateCustom('borders', 'shadow', value)} />
        </FieldGroup>
        <FieldGroup title="Spacing">
          {sizeField('spacing', 'cardPadding', 'Card padding')}
          {sizeField('spacing', 'cardGap', 'Gap between cards')}
          {sizeField('spacing', 'sectionSpacing', 'Space around widget')}
          {sizeField('spacing', 'buttonSpacing', 'Space above button')}
        </FieldGroup>
      </BlockStack>
    ),
    savings: (
      <BlockStack gap="400">
        <Toggle label="Show savings" helpText="Call out how much shoppers save on each offer." checked={form.customization.savings.visible} onChange={(value) => updateCustom('savings', 'visible', value)} />
        <FieldGroup title="Wording">
          <Segmented label="Shown as" disabled={!form.customization.savings.visible} options={[['save_amount', 'Amount'], ['save_percent', 'Percentage']]} value={form.customization.savings.mode} onChange={(value) => updateCustom('savings', 'mode', value)} />
          <TextField label="Word to use" disabled={!form.customization.savings.visible} value={form.customization.savings.label} maxLength={24} placeholder="Save" helpText={`e.g. “${form.customization.savings.label || 'Save'} ${form.customization.savings.mode === 'save_percent' ? '10%' : fmt(24)}”`} onChange={(value) => updateCustom('savings', 'label', value)} autoComplete="off" />
        </FieldGroup>
      </BlockStack>
    ),
    image: (
      <BlockStack gap="400">
        <Toggle label="Show product image" helpText="Adds the product photo to each offer card." checked={form.customization.images.enabled} onChange={(value) => updateCustom('images', 'enabled', value)} />
        <FieldGroup title="Placement">
          <Segmented label="Image size" disabled={!form.customization.images.enabled} options={['small', 'medium', 'large'].map((value) => [value, capitalize(value)])} value={form.customization.images.size} onChange={(value) => updateCustom('images', 'size', value)} />
          <Segmented label="Image position" disabled={!form.customization.images.enabled} options={[['top', 'Above title'], ['left', 'Left of title']]} value={form.customization.images.position} onChange={(value) => updateCustom('images', 'position', value)} />
        </FieldGroup>
        {!form.productImage && <Banner tone="info"><p>This product has no image yet. Pick a product with an image in step 1 to use this.</p></Banner>}
      </BlockStack>
    ),
  };

  const activeTabIndex = Math.max(0, CUSTOMIZE_TABS.findIndex((tab) => tab.id === customizeTab));
  const activeTab = CUSTOMIZE_TABS[activeTabIndex];
  const prevTab = CUSTOMIZE_TABS[activeTabIndex - 1];
  const nextTab = CUSTOMIZE_TABS[activeTabIndex + 1];
  const customizationStep = (
    <Layout>
      <Layout.Section variant="oneThird">
        <div className="pb-scroll-pane">
          <BlockStack gap="300">
            {customCheck.errors.length > 0 && <Banner tone="critical" title="Some customization values are invalid"><ul>{customCheck.errors.slice(0, 5).map((message) => <li key={message}>{message}</li>)}</ul></Banner>}
            <Card>
              <BlockStack gap="400">
                <div role="tablist" aria-label="Customize section" className="pz-nav">
                  {CUSTOMIZE_TABS.map((tab) => {
                    const selected = customizeTab === tab.id;
                    return (
                      <button key={tab.id} type="button" role="tab" aria-selected={selected} className={`pz-nav-item${selected ? ' pz-nav-item--on' : ''}`} onClick={() => setCustomizeTab(tab.id)}>
                        <span className="pz-nav-icon"><Icon source={tab.icon} tone="inherit" /></span>
                        <span>{tab.label}</span>
                        {tabHasError(tab) && <span className="pz-nav-error" title="Needs attention" aria-label="Needs attention" />}
                      </button>
                    );
                  })}
                </div>
                <div className="pz-panel-head">
                  <Text as="h3" variant="headingMd">{activeTab.label}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{activeTab.description}</Text>
                </div>
                {customizeTabPanels[activeTab.id]}
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  {prevTab ? <Button variant="tertiary" onClick={() => setCustomizeTab(prevTab.id)}>{`← ${prevTab.label}`}</Button> : <span />}
                  <Text as="span" variant="bodySm" tone="subdued">{activeTabIndex + 1} / {CUSTOMIZE_TABS.length}</Text>
                  {nextTab ? <Button variant="tertiary" onClick={() => setCustomizeTab(nextTab.id)}>{`${nextTab.label} →`}</Button> : <span />}
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>
      </Layout.Section>
      <Layout.Section>
        <div className="pb-scroll-pane">
          {storefrontPreviewCard(previewTiers)}
        </div>
      </Layout.Section>
    </Layout>
  );

  const canPublish = planState === 'enabled';
  const wasActive = isEdit && pack?.status === 'active';
  const reviewData = review.data;
  const reviewStep = (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Review</Text>
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                {form.productImage && <Thumbnail source={form.productImage} alt="" size="small" />}
                <BlockStack gap="050">
                  <Text as="span" fontWeight="semibold">{form.productTitle}</Text>
                  <Text as="span" tone="subdued">{form.variantScope === 'all' ? `All variants (${variants.length})` : `${form.allowedVariantIds.length} of ${variants.length} variants`} · {currentType.name} · {PACK_DESIGNS.find((item) => item.id === form.customization.design.preset)?.name}</Text>
                </BlockStack>
              </InlineStack>
              <Divider />
              {review.status === 'loading' && <InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span" tone="subdued">Calculating prices with Shopify…</Text></InlineStack>}
              {review.status === 'error' && <Banner tone="critical" title="Could not calculate prices" action={{ content: 'Retry', onAction: () => setReviewKey((key) => key + 1) }}><p>{review.error}</p></Banner>}
              {review.status === 'ready' && !reviewData.valid && <Banner tone="critical" title="Tiers need attention"><p>{reviewData.errors[0]?.message} Go back to the Tiers step to fix it.</p></Banner>}
              {review.status === 'ready' && reviewData.valid && (
                <BlockStack gap="200">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#6d7175' }}>{['Tier', 'Qty', 'Subtotal', 'Discount', 'Pack price', 'Savings', 'Per item'].map((heading) => <th key={heading} style={{ padding: '6px 8px', fontWeight: 500 }}>{heading}</th>)}</tr></thead>
                      <tbody>
                        {reviewData.tiers.map((tier) => (
                          <tr key={tier.quantity} style={{ borderTop: '1px solid #e1e3e5' }}>
                            <td style={{ padding: '8px' }}>{tier.name || `Buy ${tier.quantity}`}{tier.badge ? <> <Badge tone="info">{tier.badge}</Badge></> : null}</td>
                            <td style={{ padding: '8px' }}>{tier.quantity}</td>
                            <td style={{ padding: '8px' }}>{tier.formatted.subtotal}</td>
                            <td style={{ padding: '8px' }}>{tier.discountType === 'none' ? '—' : tier.discountType === 'percentage' ? `${tier.discountValue}%` : tier.formatted.discountAmount}</td>
                            <td style={{ padding: '8px', fontWeight: 600 }}>{tier.formatted.price}</td>
                            <td style={{ padding: '8px' }}>{tier.savings > 0 ? tier.formatted.savings : '—'}</td>
                            <td style={{ padding: '8px' }}>{tier.formatted.effectiveUnitPrice}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">Calculated by BRIX from the live Shopify price of {fmt(reviewData.variant.price)} per unit ({currency.code}).</Text>
                  {!reviewData.variant.availableForSale && <Banner tone="warning"><p>This variant is out of stock in Shopify. You can save a draft, but the Pack can’t be activated until it’s available.</p></Banner>}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center"><Text as="h3" variant="headingSm">Status</Text><Badge tone={wasActive ? 'success' : 'info'}>{wasActive ? 'Active' : isEdit ? (pack.status === 'inactive' ? 'Inactive' : 'Draft') : 'New (unsaved)'}</Badge></InlineStack>
              {!canPublish && <Banner tone="info" title="Publishing requires an eligible plan"><p>Your plan lets you build and preview Packs, but activating them on your storefront needs Starter or Pro. Save as a draft to keep your work.</p></Banner>}
              {canPublish && <Text as="p" tone="subdued" variant="bodySm">Activating installs the BRIX Packs checkout discount on your store so the savings apply at checkout. Shoppers only see the widget once that discount is verified active.</Text>}
              <InlineStack gap="300" wrap>
                {wasActive && canPublish ? (
                  <Button variant="primary" loading={saving === 'keep'} disabled={Boolean(saving) || review.status !== 'ready' || !reviewData?.valid} onClick={() => save('keep')}>Save changes</Button>
                ) : (
                  <>
                    <Button loading={saving === 'draft'} disabled={Boolean(saving) || !tierCheck.valid || customCheck.errors.length > 0} onClick={() => save(pack?.status === 'inactive' ? 'keep' : 'draft')}>{isEdit ? 'Save changes' : 'Save as draft'}</Button>
                    <Button variant="primary" loading={saving === 'active'} disabled={Boolean(saving) || !canPublish || review.status !== 'ready' || !reviewData?.valid || !reviewData?.variant?.availableForSale} onClick={() => save('active')}>Save &amp; activate</Button>
                  </>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Layout>
  );

  const reviewPreviewStep = (
    <Layout>
      <Layout.Section>
        {storefrontPreviewCard(reviewData?.valid ? reviewData.tiers : previewTiers)}
      </Layout.Section>
    </Layout>
  );

  const stepContent = [productStep, typeStep, configureStep, designStep, customizationStep, <BlockStack key="review" gap="400">{reviewStep}{reviewPreviewStep}</BlockStack>][step];

  return (
    <Page title={isEdit ? `Edit Pack${pack?.productTitle ? ` · ${pack.productTitle}` : ''}` : 'Create Pack'} backAction={{ content: isEdit ? 'Pack details' : 'Packs', onAction: leave }} secondaryActions={draft.dirty ? [{ content: 'Discard changes', onAction: () => { if (window.confirm('Discard all unsaved changes?')) { setForm(initialForm); draft.markSaved(initialForm); setNotice(''); } } }] : []}>
      <BlockStack gap="400">
        {draft.pendingDraft && (
          <Banner tone="info" title="Unsaved draft found" action={{ content: 'Restore draft', onAction: restoreDraft }} secondaryAction={{ content: 'Discard draft', onAction: draft.discardDraft }}>
            <p>{isEdit ? 'You have unsaved changes to this Pack' : 'You started a Pack'} in this browser on {new Date(draft.pendingDraft.savedAt).toLocaleString()}. It has not been applied.</p>
          </Banner>
        )}
        {notice && <Banner tone="success" onDismiss={() => setNotice('')}><p>{notice}</p></Banner>}
        {error && (
          <Banner tone="critical" title={error.code === 'duplicate' ? 'This product variant already has a Pack' : 'Something needs your attention'} onDismiss={() => setError(null)}
            action={error.code === 'duplicate' && error.details?.existingId ? { content: 'Open existing Pack', onAction: () => navigate(`/app/packs/${error.details.existingId}/edit`) } : undefined}>
            <p>{error.message}</p>
          </Banner>
        )}
        {builderStyles}
        <div className="pb-navbar">
          <style>{`
.pb-navbar{position:sticky;top:10px;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 16px;background:linear-gradient(135deg,#ffffff 0%,#f7fbff 100%);backdrop-filter:blur(10px);border:1px solid #dfe3e8;border-radius:14px;box-shadow:0 10px 28px rgba(15,23,42,.08)}
.pb-navbar-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pb-navbar-progress{display:flex;align-items:center;gap:6px}
.pb-navbar-dot{width:7px;height:7px;border-radius:50%;background:#d2d5d8;transition:background .15s ease,transform .15s ease}
.pb-navbar-dot--done{background:#6b6b6b}
.pb-navbar-dot--current{background:#111111;transform:scale(1.3)}
.pb-scroll-pane{position:sticky;top:76px;max-height:calc(100vh - 100px);overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:#c9cccf transparent}
.pb-scroll-pane::-webkit-scrollbar{width:8px}
.pb-scroll-pane::-webkit-scrollbar-thumb{background:#d2d5d8;border-radius:999px}
.pb-scroll-pane::-webkit-scrollbar-thumb:hover{background:#aeb2b8}
.pb-scroll-pane::-webkit-scrollbar-track{background:transparent}
@media (max-width: 900px){.pb-scroll-pane{position:static;max-height:none;overflow:visible}}
          `}</style>
          <InlineStack gap="300" blockAlign="center">
            <Button disabled={step === 0} onClick={() => goTo(step - 1)}>Back</Button>
            <span className="pb-navbar-progress" aria-hidden="true">
              {STEPS.map((label, index) => (
                <span key={label} className={`pb-navbar-dot ${index === step ? 'pb-navbar-dot--current' : index < step ? 'pb-navbar-dot--done' : ''}`} />
              ))}
            </span>
            <Text as="span" variant="bodySm" tone="subdued">{`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}</Text>
          </InlineStack>
          <div className="pb-navbar-right">
            {draft.lastAutosave && <Text as="span" variant="bodySm" tone="subdued">Draft autosaved locally</Text>}
            {step < STEPS.length - 1 && <Button variant="primary" onClick={() => goTo(step + 1)}>Continue</Button>}
          </div>
        </div>
        <Card padding="0"><Tabs tabs={STEPS.map((label, index) => ({ id: STEP_KEYS[index], content: `${index + 1}. ${label}`, accessibilityLabel: `Step ${index + 1}: ${label}` }))} selected={step} onSelect={goTo} fitted /></Card>
        {stepContent}
        {/* Room to scroll the last row clear of floating widgets (e.g. the
            "Help and Support" launcher) that sit over the bottom of the page. */}
        <div aria-hidden="true" style={{ height: 96 }} />
      </BlockStack>
    </Page>
  );
}
