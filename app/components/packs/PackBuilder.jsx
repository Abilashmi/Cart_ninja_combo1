/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppBridge } from '@shopify/app-bridge-react';
import { Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, Button, Select, TextField, Checkbox, Banner, Tabs, Divider, Badge, Box, Thumbnail, SkeletonBodyText, Spinner } from '@shopify/polaris';
import PackPreview from './PackPreview';
import usePackDraft, { draftKey } from './usePackDraft';
import { formatMoney } from '../../utils/currency.shared';
import {
  PACK_TEMPLATES, MAX_TIERS, calculateTier, defaultCustomization, mergeCustomization, normalizeTiers, sanitizeCustomization, validateTiers,
} from '../../utils/packs.shared.js';

const STEPS = ['Product', 'Template', 'Tiers', 'Customization', 'Review'];
const STEP_KEYS = ['product', 'template', 'tiers', 'customization', 'review'];

const blankTier = (quantity, discountType = 'none', discountValue = '') => ({ name: '', quantity: String(quantity), discountType, discountValue: String(discountValue), badge: '' });
const DEFAULT_TIERS = [blankTier(1), blankTier(2, 'percentage', 5), blankTier(3, 'percentage', 10)];

function emptyForm() {
  return { productId: '', productTitle: '', productImage: '', variantId: '', template: 'same_variant', tiers: DEFAULT_TIERS.map((tier) => ({ ...tier })), customization: defaultCustomization() };
}

function packToForm(pack) {
  return {
    productId: pack.productId, productTitle: pack.productTitle, productImage: pack.productImage || '', variantId: pack.variantId, template: pack.template,
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
  return (
    <InlineStack gap="200" blockAlign="end" wrap={false}>
      <div style={{ flex: 1 }}>
        <TextField label={label} value={value} onChange={onChange} autoComplete="off" error={error} monospaced />
      </div>
      <input type="color" aria-label={`${label} picker`} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value)} style={{ width: 36, height: 36, padding: 0, border: '1px solid #c9cccf', borderRadius: 6, background: 'none', cursor: 'pointer' }} />
    </InlineStack>
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
          const exists = data.product.variants.some((variant) => variant.id === current.variantId);
          const only = data.product.variants.length === 1 ? data.product.variants[0].id : '';
          if (exists) return { ...current, productTitle: data.product.title, productImage: data.product.image };
          return { ...current, variantId: only, productTitle: data.product.title, productImage: data.product.image };
        });
      })
      .catch((loadError) => { if (!cancelled) setProductData({ status: 'error', product: null, error: loadError.message }); });
    return () => { cancelled = true; };
  }, [form.productId, reloadKey]);

  const variants = productData.product?.variants || [];
  const selectedVariant = variants.find((variant) => variant.id === form.variantId) || null;
  const basePrice = selectedVariant?.price ?? null;

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

  // ── step gating ────────────────────────────────────────────────────────────
  const blocker = (target) => {
    if (target > 0 && (!form.productId || !selectedVariant)) return 'Choose a Shopify product and variant first.';
    if (target > 2 && !tierCheck.valid) return `Fix the Pack tiers first: ${tierCheck.errors[0]?.message}`;
    if (target > 3 && customCheck.errors.length > 0) return `Fix the customization first: ${customCheck.errors[0]}`;
    return null;
  };
  const goTo = (target) => {
    const reason = blocker(target);
    if (reason && target > step) { setError({ message: reason }); return; }
    setError(null);
    setStep(target);
  };

  // ── review: server-side calculation ────────────────────────────────────────
  useEffect(() => {
    if (step !== 4 || !form.productId || !form.variantId) return undefined;
    let cancelled = false;
    setReview({ status: 'loading', data: null, error: '' });
    api('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', productId: form.productId, variantId: form.variantId, tiers: form.tiers }) })
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
      update({ productId: numeric, productTitle: selected.title || '', productImage: selected.images?.[0]?.originalSrc || '', variantId: '' });
    } catch {
      setError({ message: 'Could not open the Shopify product picker. Please try again.' });
    }
  }

  async function save(status) {
    setError(null);
    setNotice('');
    setSaving(status);
    try {
      const data = await api('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: packId, productId: form.productId, variantId: form.variantId, template: form.template, tiers: form.tiers, customization: form.customization, status }) });
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
  const productStep = (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Select product</Text>
              <Text as="p" tone="subdued">Choose the Shopify product and the exact variant this Pack applies to. Price and stock are always read live from Shopify.</Text>
            </BlockStack>
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={chooseProduct}>{form.productId ? 'Change product' : 'Choose product'}</Button>
              {isEdit && form.productId && <Text as="span" tone="subdued" variant="bodySm">Changing the product changes which storefront page shows this Pack.</Text>}
            </InlineStack>
            {productData.status === 'loading' && <BlockStack gap="200"><InlineStack gap="200" blockAlign="center"><Spinner size="small" /><Text as="span" tone="subdued">Loading product from Shopify…</Text></InlineStack><SkeletonBodyText lines={2} /></BlockStack>}
            {productData.status === 'error' && <Banner tone="critical" title="Could not load this product" action={{ content: 'Retry', onAction: () => setReloadKey((key) => key + 1) }}><p>{productData.error}</p></Banner>}
            {productData.status === 'ready' && (
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    {productData.product.image && <Thumbnail source={productData.product.image} alt="" size="small" />}
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">{productData.product.title}</Text>
                      {productData.product.status !== 'ACTIVE' && <Badge tone="warning">{`Product is ${productData.product.status.toLowerCase()}`}</Badge>}
                    </BlockStack>
                  </InlineStack>
                  {!form.variantId && form.productId && variants.length > 0 && isEdit && <Banner tone="warning"><p>The previously selected variant no longer exists. Choose another variant.</p></Banner>}
                  <Select
                    label="Variant"
                    placeholder="Select a variant"
                    options={variants.map((variant) => ({ label: `${variant.title} — ${fmt(variant.price)}${variant.availableForSale ? '' : ' (out of stock)'}`, value: variant.id }))}
                    value={form.variantId}
                    onChange={(value) => update({ variantId: value })}
                  />
                  {selectedVariant && (
                    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                      <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Base price</Text><Text as="span" fontWeight="semibold">{fmt(selectedVariant.price)}</Text></BlockStack>
                      <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Availability</Text>{selectedVariant.availableForSale ? <Badge tone="success">In stock</Badge> : <Badge tone="critical">Out of stock</Badge>}</BlockStack>
                      <BlockStack gap="050"><Text as="span" tone="subdued" variant="bodySm">Inventory</Text><Text as="span">{selectedVariant.inventoryQuantity === null ? 'Not reported' : selectedVariant.inventoryPolicy === 'CONTINUE' ? `${selectedVariant.inventoryQuantity} (oversell allowed)` : selectedVariant.inventoryQuantity}</Text></BlockStack>
                    </InlineGrid>
                  )}
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Checklist</Text>
            <Text as="p" tone={form.productId ? 'success' : 'subdued'}>{form.productId ? '✓ Product selected' : '○ Select a product'}</Text>
            <Text as="p" tone={selectedVariant ? 'success' : 'subdued'}>{selectedVariant ? '✓ Variant selected' : '○ Select a variant'}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const templateStep = (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Choose a template</Text>
        <div role="radiogroup" aria-label="Pack template" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {PACK_TEMPLATES.map((item) => {
            const selected = form.template === item.id;
            return (
              <button key={item.id} type="button" role="radio" aria-checked={selected} onClick={() => update({ template: item.id })}
                style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', background: selected ? '#f1f8f5' : '#fff', border: `2px solid ${selected ? '#008060' : '#dfe3e8'}`, borderRadius: 8, padding: 16 }}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center"><Text as="span" fontWeight="semibold">{item.name}</Text>{selected && <Badge tone="success">Selected</Badge>}</InlineStack>
                  <Text as="p" tone="subdued">{item.description}</Text>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200"><Text as="p" alignment="center" fontWeight="medium">{item.preview}</Text></Box>
                  <Text as="span" variant="bodySm" tone="subdued">{item.recommended}</Text>
                </BlockStack>
              </button>
            );
          })}
        </div>
      </BlockStack>
    </Card>
  );

  const tiersStep = (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">Pack tiers</Text>
              <Text as="p" tone="subdued">Each tier is a quantity of {selectedVariant ? `“${selectedVariant.title}”` : 'the variant'} sold at a set discount. Base price: {basePrice === null ? '—' : fmt(basePrice)}.</Text>
            </BlockStack>
            <Button disabled={form.tiers.length >= MAX_TIERS} onClick={() => { const last = Math.max(0, ...form.tiers.map((tier) => Number(tier.quantity) || 0)); setForm((current) => ({ ...current, tiers: [...current.tiers, blankTier(last + 1)] })); }}>Add tier</Button>
          </InlineStack>
          {tierCheck.errors.filter((item) => item.index === null).map((item) => <Banner key={item.message} tone="critical"><p>{item.message}</p></Banner>)}
          {form.tiers.map((tier, index) => {
            const valid = !tierCheck.errors.some((item) => item.index === index);
            const calc = valid && basePrice !== null ? calculateTier(basePrice, { quantity: Number(tier.quantity), discountType: tier.discountType, discountValue: Number(tier.discountValue) }, { currencyCode: currency.code, locale: currency.locale }) : null;
            return (
              <Box key={index} background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingSm">Tier {index + 1}</Text>
                    <Button variant="plain" tone="critical" disabled={form.tiers.length <= 1} onClick={() => setForm((current) => ({ ...current, tiers: current.tiers.filter((_, i) => i !== index) }))} accessibilityLabel={`Remove tier ${index + 1}`}>Remove</Button>
                  </InlineStack>
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                    <TextField label="Quantity" type="number" min={1} max={100} value={tier.quantity} onChange={(value) => updateTier(index, { quantity: value })} onBlur={sortTiers} autoComplete="off" error={tierErrors(index, 'quantity')} />
                    <Select label="Discount" options={[{ label: 'No discount', value: 'none' }, { label: 'Percentage off', value: 'percentage' }, { label: 'Fixed amount off', value: 'fixed' }]} value={tier.discountType} onChange={(value) => updateTier(index, { discountType: value, discountValue: value === 'none' ? '' : tier.discountValue })} />
                    <TextField label="Value" type="number" min={0} disabled={tier.discountType === 'none'} value={tier.discountValue} onChange={(value) => updateTier(index, { discountValue: value })} suffix={tier.discountType === 'percentage' ? '%' : tier.discountType === 'fixed' ? currency.code : undefined} autoComplete="off" error={tierErrors(index, 'discountValue')} />
                    <TextField label="Badge (optional)" value={tier.badge} maxLength={24} onChange={(value) => updateTier(index, { badge: value })} placeholder="e.g. Best value" autoComplete="off" error={tierErrors(index, 'badge')} />
                  </InlineGrid>
                  <TextField label="Display name (optional)" value={tier.name} maxLength={60} onChange={(value) => updateTier(index, { name: value })} placeholder={`Buy ${Number(tier.quantity) || ''}`.trim()} autoComplete="off" error={tierErrors(index, 'name')} />
                  <Divider />
                  {calc ? (
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="300">
                      {[['Unit price', calc.formatted.baseUnitPrice], ['Normal subtotal', calc.formatted.subtotal], ['Discount', `−${calc.formatted.discountAmount}`], ['Pack price', calc.formatted.price], ['Savings', calc.formatted.savings], ['Per item', calc.formatted.effectiveUnitPrice]].map(([label, value]) => (
                        <BlockStack key={label} gap="050"><Text as="span" variant="bodySm" tone="subdued">{label}</Text><Text as="span" fontWeight={label === 'Pack price' ? 'bold' : 'regular'}>{value}</Text></BlockStack>
                      ))}
                    </InlineGrid>
                  ) : <Text as="p" tone="subdued" variant="bodySm">{basePrice === null ? 'Select a variant to preview prices.' : 'Fix the highlighted fields to preview this tier’s price.'}</Text>}
                </BlockStack>
              </Box>
            );
          })}
        </BlockStack>
      </Card>
    </BlockStack>
  );

  const contentField = (key, label, maxLength, multiline) => <TextField label={label} value={form.customization.content[key]} maxLength={maxLength} multiline={multiline} onChange={(value) => updateCustom('content', key, value)} autoComplete="off" />;
  const numberField = (group, key, label, min, max, suffix = 'px') => <TextField label={label} type="number" min={min} max={max} value={String(form.customization[group][key])} suffix={suffix} onChange={(value) => updateCustom(group, key, value === '' ? '' : Number(value))} autoComplete="off" error={customCheck.errors.find((message) => message.startsWith(`${group}.${key} `))} />;
  const colorField = (key, label) => <ColorField key={key} label={label} value={form.customization.colors[key]} onChange={(value) => updateCustom('colors', key, value)} error={customCheck.errors.find((message) => message.startsWith(`colors.${key} `))} />;

  const customizationStep = (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {customCheck.errors.length > 0 && <Banner tone="critical" title="Some customization values are invalid"><ul>{customCheck.errors.slice(0, 5).map((message) => <li key={message}>{message}</li>)}</ul></Banner>}
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Content</Text>
            {contentField('heading', 'Heading', 80)}
            {contentField('subheading', 'Subheading', 160)}
            {contentField('promoText', 'Promotional text (shown above the button)', 160)}
            {contentField('cta', 'Button label', 40)}
          </BlockStack></Card>
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Colors</Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              {[['primary', 'Accent / selected border'], ['background', 'Widget background'], ['cardBackground', 'Card background'], ['selectedCard', 'Selected card'], ['border', 'Border'], ['text', 'Text'], ['price', 'Price'], ['discount', 'Savings text'], ['badge', 'Badge background']].map(([key, label]) => colorField(key, label))}
            </InlineGrid>
          </BlockStack></Card>
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Button</Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">{colorField('button', 'Button color')}{colorField('buttonText', 'Button text color')}</InlineGrid>
          </BlockStack></Card>
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Typography</Text>
            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
              {numberField('typography', 'headingSize', 'Heading size', 12, 40)}
              {numberField('typography', 'packTitleSize', 'Pack title size', 11, 28)}
              {numberField('typography', 'priceSize', 'Price size', 12, 36)}
              {numberField('typography', 'descriptionSize', 'Detail text size', 10, 24)}
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <Select label="Font weight" options={[{ label: 'Regular', value: '400' }, { label: 'Medium', value: '500' }, { label: 'Semibold', value: '600' }, { label: 'Bold', value: '700' }]} value={String(form.customization.typography.fontWeight)} onChange={(value) => updateCustom('typography', 'fontWeight', Number(value))} />
              <Select label="Heading alignment" options={['left', 'center', 'right'].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} value={form.customization.typography.alignment} onChange={(value) => updateCustom('typography', 'alignment', value)} />
            </InlineGrid>
          </BlockStack></Card>
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Borders and spacing</Text>
            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
              {numberField('borders', 'radius', 'Corner radius', 0, 32)}
              {numberField('borders', 'width', 'Border width', 0, 6)}
              {numberField('spacing', 'cardPadding', 'Card padding', 4, 40)}
              {numberField('spacing', 'cardGap', 'Gap between cards', 0, 32)}
              {numberField('spacing', 'sectionSpacing', 'Space around widget', 0, 60)}
              {numberField('spacing', 'buttonSpacing', 'Space above button', 0, 40)}
            </InlineGrid>
            <InlineStack gap="400" blockAlign="end" wrap>
              <Select label="Border style" options={['solid', 'dashed', 'dotted'].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} value={form.customization.borders.style} onChange={(value) => updateCustom('borders', 'style', value)} />
              <Checkbox label="Drop shadow" checked={form.customization.borders.shadow} onChange={(value) => updateCustom('borders', 'shadow', value)} />
            </InlineStack>
          </BlockStack></Card>
          <Card><BlockStack gap="300">
            <Text as="h3" variant="headingSm">Savings and layout</Text>
            <InlineStack gap="400" blockAlign="end" wrap>
              <Checkbox label="Show savings" checked={form.customization.savings.visible} onChange={(value) => updateCustom('savings', 'visible', value)} />
              <Select label="Show savings as" disabled={!form.customization.savings.visible} options={[{ label: 'Amount (e.g. Save 24.00)', value: 'save_amount' }, { label: 'Percentage (e.g. Save 10%)', value: 'save_percent' }]} value={form.customization.savings.mode} onChange={(value) => updateCustom('savings', 'mode', value)} />
            </InlineStack>
            {form.template === 'visual_offer' ? (
              <InlineStack gap="400" blockAlign="end" wrap>
                <Checkbox label="Show product image" checked={form.customization.images.enabled} onChange={(value) => updateCustom('images', 'enabled', value)} />
                <Select label="Image size" disabled={!form.customization.images.enabled} options={['small', 'medium', 'large'].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))} value={form.customization.images.size} onChange={(value) => updateCustom('images', 'size', value)} />
                <Select label="Image position" disabled={!form.customization.images.enabled} options={[{ label: 'Above title', value: 'top' }, { label: 'Left of title', value: 'left' }]} value={form.customization.images.position} onChange={(value) => updateCustom('images', 'position', value)} />
              </InlineStack>
            ) : <Text as="p" variant="bodySm" tone="subdued">Image options are available with the Visual Offer template.</Text>}
          </BlockStack></Card>
        </BlockStack>
      </Layout.Section>
      <Layout.Section variant="oneThird">
        <div style={{ position: 'sticky', top: 16 }}>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Live preview</Text>
              <PackPreview template={form.template} customization={form.customization} tiers={previewTiers} productImage={form.productImage} formatMoney={fmt} />
              <Text as="p" variant="bodySm" tone="subdued">Preview shows your saved styling. Final prices always come from Shopify at checkout.</Text>
            </BlockStack>
          </Card>
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
                  <Text as="span" tone="subdued">{selectedVariant?.title || 'No variant selected'} · {PACK_TEMPLATES.find((item) => item.id === form.template)?.name}</Text>
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
      <Layout.Section variant="oneThird">
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Storefront preview</Text>
            <PackPreview template={form.template} customization={form.customization} tiers={reviewData?.valid ? reviewData.tiers : previewTiers} productImage={form.productImage} formatMoney={fmt} />
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );

  const stepContent = [productStep, templateStep, tiersStep, customizationStep, reviewStep][step];

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
        <Card padding="0"><Tabs tabs={STEPS.map((label, index) => ({ id: STEP_KEYS[index], content: `${index + 1}. ${label}`, accessibilityLabel: `Step ${index + 1}: ${label}` }))} selected={step} onSelect={goTo} fitted /></Card>
        {stepContent}
        <InlineStack align="space-between">
          <Button disabled={step === 0} onClick={() => goTo(step - 1)}>Back</Button>
          <InlineStack gap="300" blockAlign="center">
            {draft.lastAutosave && <Text as="span" variant="bodySm" tone="subdued">Draft autosaved locally</Text>}
            {step < STEPS.length - 1 && <Button variant="primary" onClick={() => goTo(step + 1)}>Continue</Button>}
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
