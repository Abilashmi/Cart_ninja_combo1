import { memo, useEffect, useMemo, useState } from 'react';
import { useFetcher } from 'react-router';
import {
  Banner, BlockStack, Box, Button, Checkbox, ChoiceList, FormLayout, InlineStack, Select, Tag, Text, TextField,
} from '@shopify/polaris';
import { useAppBridge } from '@shopify/app-bridge-react';
import { SectionCard } from './SectionCard';
import { LockedOverlay, ProBadge } from '../plan/PlanGate';
import { usePlan } from '../PlanContext';
import { useCurrency } from '../CurrencyContext';
import {
  DEFAULT_MESSAGES, LIMITS, QUICK_SHOP_LAYOUT, WEIGHT_BOX_LAYOUT, defaultWeightPricing, formatItems, formatMoney, formatWeight, isWeightCombo,
  measureOf, normalizeWeightPricing, tierLabel,
} from '../../utils/combo-weight.shared.js';

const FEATURE = 'combo_weight_pricing';

const TYPE_OPTIONS = [
  { label: 'Percentage off', value: 'percentage' },
  { label: 'Amount off', value: 'fixed_amount' },
  { label: 'Box price', value: 'fixed_price' },
];

// Quick Shop: what the box is measured by (weight_pricing.measure).
const MEASURE_CHOICES = [
  { label: 'Weight', value: 'weight', helpText: 'e.g. 1 kg → 10% off. Uses each variant\'s Shopify weight.' },
  { label: 'Quantity', value: 'quantity', helpText: 'e.g. 3 items → 10% off, or any 3 for a box price.' },
  { label: 'Value', value: 'value', helpText: 'e.g. spend 999 → 100 off.' },
];

// Whole numbers (item counts) or amounts, typed freely and committed on blur.
function NumberField({ label, value, onCommit, error, helpText, placeholder, prefix, suffix, step = 1 }) {
  const shown = value == null || value === '' ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const text = String(draft).trim();
    if (text === '') { onCommit(null); return; }
    const n = Number(text);
    onCommit(Number.isFinite(n) ? n : text);
  };
  return (
    <TextField
      label={label} type="number" value={draft} onChange={setDraft} onBlur={commit} autoComplete="off"
      error={error} helpText={helpText} placeholder={placeholder} prefix={prefix} suffix={suffix} min={0} step={step}
    />
  );
}

// Weights are stored in whole grams and typed in the merchant's unit; the
// draft keeps "1." etc. while typing and is committed on blur.
function WeightField({ label, grams, unit, onCommit, error, helpText, placeholder }) {
  const shown = grams == null || grams === '' ? '' : String(unit === 'kg' ? Number(grams) / 1000 : grams);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const text = String(draft).trim();
    if (text === '') { onCommit(null); return; }
    const n = Number(text);
    onCommit(Number.isFinite(n) ? Math.round(unit === 'kg' ? n * 1000 : n) : text);
  };
  return (
    <TextField
      label={label} type="number" value={draft} onChange={setDraft} onBlur={commit}
      suffix={unit} autoComplete="off" error={error} helpText={helpText} placeholder={placeholder}
      min={0} step={unit === 'kg' ? 0.05 : 50}
    />
  );
}

function offerText(tier, symbol) {
  if (tier.type === 'percentage') return `${tier.value}% off`;
  if (tier.type === 'fixed_amount') return `${symbol}${tier.value} off`;
  return `box for ${symbol}${tier.value}`;
}

function statusTone(status) {
  if (!status) return 'info';
  if (status.verified) return 'success';
  return ['not_deployed', 'failed', 'too_large', 'inactive', 'discount_inactive'].includes(status.state) ? 'critical' : 'warning';
}

function OfferSectionComponent({
  config,
  updateConfig,
  expanded,
  onToggle,
  localActiveDiscounts = [],
  onCreateCoupon,
  weightStatus = null,
  savedWeightHash = null,
}) {
  const shopify = useAppBridge();
  const { canPublishFeature } = usePlan();
  const { symbol } = useCurrency();
  const auditFetcher = useFetcher();
  const isWeight = isWeightCombo(config);
  const isWeightBox = config.layout === WEIGHT_BOX_LAYOUT;
  const isQuickShop = config.layout === QUICK_SHOP_LAYOUT;
  // Drawn with the Quick Shop design (Quick Shop, or the Weight Box): tier
  // labels show on the page, extra options folded away.
  const qsDesign = isQuickShop || isWeightBox;
  const canUseWeight = canPublishFeature(FEATURE);
  const raw = config.weight_pricing || defaultWeightPricing();
  const unit = raw.unit === 'g' ? 'g' : 'kg';
  // Only Quick Shop offers quantity / value; every other layout is weighed.
  const measure = isQuickShop ? measureOf(raw) : 'weight';
  const byWeight = measure === 'weight';
  const byValue = measure === 'value';
  const [showMore, setShowMore] = useState(false);
  const shownAmount = (n) => (byWeight ? formatWeight(n, unit) : byValue ? formatMoney(n, symbol) : formatItems(n));
  const { value, errors, warnings } = useMemo(() => normalizeWeightPricing(raw), [raw]);
  const errorFor = (field) => errors.find((e) => e.field === field)?.message;
  const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
  const qualify = raw.qualify || { mode: 'layout_collections', collection_ids: [], product_ids: [] };

  const setWeight = (patch) => updateConfig('weight_pricing', { ...raw, ...patch });
  const setTier = (index, patch) => setWeight({ tiers: tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const step = byWeight ? 1000 : byValue ? 500 : 2;
    const nextGrams = last && Number(last.min_grams) > 0 ? Number(last.min_grams) + step : step;
    setWeight({ tiers: [...tiers, { id: `t${Date.now().toString(36)}`, min_grams: nextGrams, type: 'percentage', value: 10, label: '' }] });
  };
  const removeTier = (index) => setWeight({ tiers: tiers.filter((_, i) => i !== index) });
  const setQualify = (patch) => setWeight({ qualify: { ...qualify, ...patch } });
  const setMessage = (key, text) => setWeight({ messages: { ...(raw.messages || {}), [key]: text } });
  // A new measure starts from its own sample tier; which products count and
  // the before/after messages carry over.
  const setMeasure = (next) => {
    if (next === measure) return;
    const fresh = defaultWeightPricing(next);
    updateConfig('weight_pricing', {
      ...fresh,
      qualify: raw.qualify || fresh.qualify,
      messages: { ...fresh.messages, locked: raw.messages?.locked ?? fresh.messages.locked, unlocked: raw.messages?.unlocked ?? fresh.messages.unlocked },
    });
  };

  const pick = async (type) => {
    const key = type === 'product' ? 'product_ids' : 'collection_ids';
    const current = qualify[key] || [];
    try {
      const selected = await shopify.resourcePicker({ type, multiple: true, selectionIds: current.map((id) => ({ id })) });
      if (!selected) return;
      const limit = type === 'product' ? LIMITS.products : LIMITS.collections;
      const chosen = selected.slice(0, limit);
      setQualify({ [key]: chosen.map((r) => r.id) });
      // Names for the tags, kept outside weight_pricing (the server keeps only ids there).
      updateConfig('weight_qualify_titles', { ...(config.weight_qualify_titles || {}), ...Object.fromEntries(chosen.map((r) => [r.id, r.title])) });
    } catch {
      shopify.toast.show('Could not open the picker. Please try again.', { isError: true });
    }
  };
  const titleOf = (id, fallback) => config.weight_qualify_titles?.[id] || fallback;
  const removeQualified = (key, id) => setQualify({ [key]: (qualify[key] || []).filter((x) => x !== id) });

  const runAudit = () => {
    auditFetcher.submit(JSON.stringify({ config: { ...config, weight_pricing: value } }), {
      method: 'POST', action: '/api/combo-weight-audit', encType: 'application/json',
    });
  };
  const audit = auditFetcher.data;

  const summary = value.tiers.length && !errors.length
    ? value.tiers.map((t) => `${shownAmount(t.min_grams)}+: ${offerText(t, symbol)}`).join(' · ')
      + (value.max_grams != null ? ` (max ${shownAmount(value.max_grams)})` : '')
    : null;
  const unsaved = isWeight && savedWeightHash && savedWeightHash !== value.hash;

  const couponOptions = (localActiveDiscounts || []).map((d) => ({
    label: `${d.title || d.code || 'Untitled'} (${d.code || ''})`,
    value: String(d.id),
  }));

  const modeChoices = [
    { label: 'Item count', value: 'count', helpText: 'Shoppers pick a number of items; you can add a coupon code.' },
    {
      label: (
        <InlineStack gap="200" blockAlign="center">
          <span>Weight-based box</span>
          <ProBadge featureKey={FEATURE} />
        </InlineStack>
      ),
      value: 'weight',
      helpText: 'Price the box by its weight: unlock a discount or a box price at weights you set.',
      disabled: !canUseWeight && !isWeight,
    },
  ];

  const moreOptions = (
    <BlockStack gap="400">
      {byWeight ? (
        <WeightField
          label="Max box weight" unit={unit} grams={raw.max_grams}
          onCommit={(g) => setWeight({ max_grams: g })}
          error={errorFor('max_grams')}
          placeholder="No limit"
          helpText="Shoppers can't add past this weight. Required when a tier is a box price."
        />
      ) : !byValue && (
        <NumberField
          label="Max items in the box" value={raw.max_grams} onCommit={(n) => setWeight({ max_grams: n })}
          error={errorFor('max_grams')} placeholder="No limit" suffix="items"
          helpText="Shoppers can't add more than this. Required when a tier is a box price (e.g. any 3 for 499)."
        />
      )}
      <BlockStack gap="200">
        <ChoiceList
          title="Which products count toward the box"
          choices={[
            { label: 'Every product on this combo page', value: 'layout_collections' },
            { label: 'Only products or collections I choose', value: 'selected' },
          ]}
          selected={[qualify.mode === 'selected' ? 'selected' : 'layout_collections']}
          onChange={([v]) => setQualify({ mode: v })}
        />
        {qualify.mode === 'selected' && (
          <BlockStack gap="200">
            <InlineStack gap="200">
              <Button onClick={() => pick('product')}>Choose products ({(qualify.product_ids || []).length})</Button>
              <Button onClick={() => pick('collection')}>Choose collections ({(qualify.collection_ids || []).length})</Button>
            </InlineStack>
            <InlineStack gap="100" wrap>
              {(qualify.product_ids || []).map((id) => (
                <Tag key={id} onRemove={() => removeQualified('product_ids', id)}>{titleOf(id, `Product ${id.split('/').pop()}`)}</Tag>
              ))}
              {(qualify.collection_ids || []).map((id) => (
                <Tag key={id} onRemove={() => removeQualified('collection_ids', id)}>{titleOf(id, `Collection ${id.split('/').pop()}`)}</Tag>
              ))}
            </InlineStack>
            {errorFor('qualify') && <Text as="p" tone="critical" variant="bodySm">{errorFor('qualify')}</Text>}
          </BlockStack>
        )}
      </BlockStack>

      {byWeight && <BlockStack gap="200">
        <Button onClick={runAudit} loading={auditFetcher.state !== 'idle'}>Check product weights</Button>
        {audit?.success && (
          audit.missing.length === 0
            ? <Text as="p" tone="success" variant="bodySm">All {audit.checked} variants checked have a weight.</Text>
            : (
              <Banner tone="warning" title={`${audit.missing.length} variant${audit.missing.length === 1 ? '' : 's'} without a weight won't count toward the box`}>
                <BlockStack gap="100">
                  {audit.missing.slice(0, 15).map((m) => (
                    <a key={m.variantId} href={m.adminUrl}>{m.title}{m.variantTitle ? ` (${m.variantTitle})` : ''}</a>
                  ))}
                  {audit.missing.length > 15 && <Text as="span" variant="bodySm">…and {audit.missing.length - 15} more.</Text>}
                  {audit.truncated && <Text as="span" variant="bodySm">Only the first products of very large collections were checked.</Text>}
                </BlockStack>
              </Banner>
            )
        )}
        {audit && !audit.success && <Text as="p" tone="critical" variant="bodySm">{audit.error || 'Could not check weights.'}</Text>}
      </BlockStack>}

      <BlockStack gap="200">
        <Text as="h6" variant="headingSm">Messages on the page</Text>
        <TextField label="Before a tier is reached" autoComplete="off" value={raw.messages?.locked ?? DEFAULT_MESSAGES.locked}
          onChange={(v) => setMessage('locked', v)} helpText={`{{remaining}} = ${byWeight ? 'weight' : byValue ? 'amount' : 'items'} still to add, {{tier}} = the next tier's label`} />
        <TextField label="When a tier is reached" autoComplete="off" value={raw.messages?.unlocked ?? DEFAULT_MESSAGES.unlocked}
          onChange={(v) => setMessage('unlocked', v)} helpText="{{tier}} = the tier's label" />
        {!byValue && <TextField label="When the box is full" autoComplete="off" value={raw.messages?.over_max ?? value.messages.over_max}
          onChange={(v) => setMessage('over_max', v)} helpText={`{{max}} = the max ${byWeight ? 'weight' : 'number of items'}`} />}
      </BlockStack>

    </BlockStack>
  );

  const weightEditor = (
    <BlockStack gap="400">
      {weightStatus && isWeight && (
        <Banner tone={statusTone(weightStatus)} title={weightStatus.verified ? 'Box discount is live in checkout' : 'Box discount is not live yet'}>
          <p>{weightStatus.message}</p>
          {unsaved && <p>You have changed the pricing. Save to send it to checkout.</p>}
        </Banner>
      )}
      {!weightStatus && isWeight && (
        <Banner tone="info"><p>Save this combo to set up its box discount in Shopify checkout.</p></Banner>
      )}

      {isQuickShop && (
        <ChoiceList
          title="Box measured by"
          choices={MEASURE_CHOICES}
          selected={[measure]}
          onChange={([v]) => setMeasure(v)}
        />
      )}

      {byWeight && (
        <Select
          label="Weight unit"
          options={[{ label: 'Kilograms (kg)', value: 'kg' }, { label: 'Grams (g)', value: 'g' }]}
          value={unit}
          onChange={(v) => setWeight({ unit: v })}
          helpText="How weights are shown here and to shoppers. Each item's weight comes from its Shopify variant weight."
        />
      )}

      <BlockStack gap="300">
        <Text as="h6" variant="headingSm">{byWeight ? 'Weight tiers' : 'Tiers'}</Text>
        {tiers.map((tier, index) => (
          <Box key={tier.id || index} padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">Tier {index + 1}</Text>
                {tiers.length > 1 && <Button variant="plain" tone="critical" onClick={() => removeTier(index)}>Remove</Button>}
              </InlineStack>
              <div className="cst-grid-2">
                {byWeight ? (
                  <WeightField
                    label="Box weighs at least" unit={unit} grams={tier.min_grams}
                    onCommit={(g) => setTier(index, { min_grams: g })}
                    error={errorFor(`tiers.${index}.min_grams`)}
                  />
                ) : (
                  <NumberField
                    label={byValue ? 'Box total at least' : 'Box has at least'}
                    value={tier.min_grams} onCommit={(n) => setTier(index, { min_grams: n })}
                    prefix={byValue ? symbol : undefined} suffix={byValue ? undefined : 'items'} step={byValue ? 1 : 1}
                    error={errorFor(`tiers.${index}.min_grams`)}
                  />
                )}
                <Select
                  label="Shopper gets" options={byValue ? TYPE_OPTIONS.filter((o) => o.value !== 'fixed_price') : TYPE_OPTIONS} value={tier.type || 'percentage'}
                  onChange={(v) => setTier(index, { type: v })}
                  error={errorFor(`tiers.${index}.type`)}
                />
              </div>
              <TextField
                label={tier.type === 'percentage' ? 'Percentage off' : tier.type === 'fixed_amount' ? 'Amount off the box' : 'Price of the whole box'}
                type="number" autoComplete="off"
                value={tier.value === '' || tier.value == null ? '' : String(tier.value)}
                onChange={(v) => setTier(index, { value: v === '' ? '' : Number(v) })}
                prefix={tier.type === 'percentage' ? undefined : symbol}
                suffix={tier.type === 'percentage' ? '%' : undefined}
                error={errorFor(`tiers.${index}.value`)}
              />
              <TextField
                label={qsDesign ? 'Label on the page and at checkout' : 'Label at checkout'} autoComplete="off" maxLength={LIMITS.label}
                value={tier.label || ''}
                placeholder={qsDesign ? (tier.type === 'percentage' ? `${tier.value}% OFF` : tier.type === 'fixed_amount' ? `${symbol}${tier.value} OFF` : `Box at ${symbol}${tier.value}`) : tierLabel({ ...tier, label: '' }, unit, measure)}
                helpText={qsDesign ? 'e.g. FREE DELIVERY. Shoppers see it in the progress bars.' : undefined}
                onChange={(v) => setTier(index, { label: v })}
              />
            </BlockStack>
          </Box>
        ))}
        {errorFor('tiers') && <Text as="p" tone="critical" variant="bodySm">{errorFor('tiers')}</Text>}
        {tiers.length < LIMITS.tiers && <Button onClick={addTier}>Add tier</Button>}
      </BlockStack>

      {qsDesign && (
        <Button variant="plain" disclosure={showMore ? 'up' : 'down'} onClick={() => setShowMore((v) => !v)}>
          More options
        </Button>
      )}
      {(!qsDesign || showMore) && moreOptions}

      {summary && (
        <Box padding="300" background="bg-surface-success" borderRadius="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">{summary}</Text>
        </Box>
      )}
      {errors.length > 0 && (
        <Banner tone="critical" title="Fix these before saving">
          <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul>
        </Banner>
      )}
      {warnings.map((w) => <Text key={w.field} as="p" tone="caution" variant="bodySm">{w.message}</Text>)}
    </BlockStack>
  );

  return (
    <SectionCard title="Offer" expanded={expanded} onToggle={onToggle} badge={isWeight ? (isQuickShop ? { weight: 'Weight', quantity: 'Quantity', value: 'Value' }[measure] : 'Weight') : null}>
      <FormLayout>
        {isQuickShop ? (
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">Quick Shop boxes unlock offers by weight, number of items or value, applied in Shopify checkout.</Text>
            <ProBadge featureKey={FEATURE} />
          </InlineStack>
        ) : isWeightBox ? (
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">The Weight Box is the Quick Shop design, always priced by the weight of the box.</Text>
            <ProBadge featureKey={FEATURE} />
          </InlineStack>
        ) : (
          <ChoiceList
            title="How this combo is priced"
            choices={modeChoices}
            selected={[isWeight ? 'weight' : 'count']}
            onChange={([v]) => {
              updateConfig('pricing_mode', v);
              if (v === 'weight') {
                if (!config.weight_pricing) updateConfig('weight_pricing', defaultWeightPricing());
                // A weight box never also sends a coupon code.
                updateConfig('has_discount_offer', false);
                updateConfig('selected_discount_id', null);
              }
            }}
          />
        )}

        {isWeight ? (
          canUseWeight ? weightEditor : (
            <BlockStack gap="200">
              <Banner tone="warning">
                <p>{isQuickShop ? 'Quick Shop box pricing is part of the Pro plan. Upgrade to save this combo.' : 'Weight-based pricing is part of the Pro plan. This combo can\'t be saved with it on your plan; switch back to item count, or upgrade.'}</p>
              </Banner>
              <LockedOverlay featureKey={FEATURE}>{weightEditor}</LockedOverlay>
            </BlockStack>
          )
        ) : (
          <>
            <Checkbox
              label="Offer a coupon?"
              checked={!!config.has_discount_offer}
              onChange={(v) => {
                updateConfig('has_discount_offer', v);
                if (!v) updateConfig('selected_discount_id', null);
              }}
              helpText="Enable to offer a coupon code with this bundle"
            />
            {!config.has_discount_offer && (
              <Button variant="secondary" onClick={() => onCreateCoupon?.()} fullWidth>
                Create Coupon
              </Button>
            )}
            {!!config.has_discount_offer && (
              couponOptions.length > 0 ? (
                <Select
                  label="Select Coupon"
                  value={String(config.selected_discount_id || '')}
                  placeholder="Choose a coupon..."
                  options={couponOptions}
                  onChange={(v) => updateConfig('selected_discount_id', v || null)}
                />
              ) : (
                <>
                  <Text as="p" variant="bodySm" tone="subdued">No coupons created yet.</Text>
                  <Button variant="secondary" onClick={() => onCreateCoupon?.()} fullWidth>
                    Create Coupon
                  </Button>
                </>
              )
            )}
          </>
        )}
      </FormLayout>
    </SectionCard>
  );
}

export const OfferSection = memo(OfferSectionComponent);
