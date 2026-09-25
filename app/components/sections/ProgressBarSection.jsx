import React, { useState, useEffect, useCallback } from 'react';
import { Card, FormLayout, TextField, Select, BlockStack, Text, InlineStack, Button, Divider, Badge, Modal } from '@shopify/polaris';
import { GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon, DiscountFilledIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import ProductPickerBody from '../shared/ProductPickerBody';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';
import { CustomizableLockedSection, ProBadge } from '../plan/PlanGate';
import { useCurrency } from '../CurrencyContext';

const TIER_ICON_MAP = {
  gift: GiftCardFilledIcon,
  shipping: DeliveryFilledIcon,
  star: StarFilledIcon,
  trophy: RewardIcon,
  diamond: DiscountFilledIcon,
};

const PRODUCT_PICKER_STORAGE_KEY = 'cached_products';


function ProductPickerModal({ open, onClose, onSave, initialSelectedIds, title }) {
  const { allProducts: contextProducts } = useCartEditor();
  const { symbol: currencySymbol } = useCurrency();
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds || []);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(initialSelectedIds || []);
    if (initialized && allProducts.length > 0) return;
    if (contextProducts && contextProducts.length > 0) {
      setAllProducts(contextProducts);
      try { sessionStorage.setItem(PRODUCT_PICKER_STORAGE_KEY, JSON.stringify(contextProducts)); } catch {}
      setInitialized(true);
      return;
    }
    const cached = sessionStorage.getItem(PRODUCT_PICKER_STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.length > 0) {
          setAllProducts(parsed);
          setInitialized(true);
          return;
        }
      } catch {}
    }
    setLoading(true);
    setFetchError(false);
    fetch('/api/upsell')
      .then(r => r.json())
      .then(data => {
        if (!data?.success) {
          setFetchError(true);
          setAllProducts([]);
          setLoading(false);
          setInitialized(true);
          return;
        }
        const products = data?.data?.allProducts || [];
        setAllProducts(products);
        if (products.length > 0) {
          try { sessionStorage.setItem(PRODUCT_PICKER_STORAGE_KEY, JSON.stringify(products)); } catch {}
        }
        setLoading(false);
        setInitialized(true);
      })
      .catch(() => {
        setFetchError(true);
        setLoading(false);
        setInitialized(true);
      });
  }, [open, initialSelectedIds, contextProducts]);

  return (
    <Modal open={open} onClose={onClose} title={title || 'Select Products'} size="large"
      primaryAction={{ content: 'Save Selection', onAction: () => { onSave(selectedIds); onClose(); } }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        {loading ? (
          <Text as="p" variant="bodyMd">Loading products...</Text>
        ) : fetchError ? (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" tone="critical">Failed to load products. Check your connection.</Text>
            <Button size="slim" onClick={() => { setLoading(true); setFetchError(false); fetch('/api/upsell').then(r => r.json()).then(data => { setAllProducts(data?.data?.allProducts || []); setLoading(false); }).catch(() => { setFetchError(true); setLoading(false); }) }}>Retry</Button>
          </BlockStack>
        ) : allProducts.length === 0 ? (
          <Text as="p" variant="bodyMd" tone="subdued">No products found. Make sure your store has products.</Text>
        ) : (
          <ProductPickerBody products={allProducts} selectedIds={selectedIds} setSelectedIds={setSelectedIds} currencySymbol={currencySymbol} resetKey={open} />
        )}
      </Modal.Section>
    </Modal>
  );
}

const REWARD_CARD_CSS = `
.rpc{border:1.5px dashed #c9cccf;border-radius:12px;padding:14px;background:#fafbfb;display:flex;flex-direction:column;gap:12px}
.rpc[data-filled="true"]{border:1px solid #e1e3e5;border-style:solid;background:linear-gradient(135deg,#f6fbf8 0%,#ffffff 70%);box-shadow:0 1px 2px rgba(16,24,40,.04)}
.rpc-empty{display:flex;align-items:center;gap:12px}
.rpc-ic{flex-shrink:0;width:40px;height:40px;border-radius:11px;background:#e3f1df;color:#0c5132;display:flex;align-items:center;justify-content:center}
.rpc-empty .rpc-ic{background:#eef0f2;color:#6d7175}
.rpc-txt{min-width:0;flex:1}
.rpc-title{margin:0;font-size:13px;font-weight:650;color:#202223}
.rpc-sub{margin:2px 0 0;font-size:12px;color:#6d7175;line-height:1.35}
.rpc-thumbs{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rpc-thumb{position:relative;width:44px;height:44px;border-radius:10px;border:1px solid #e1e3e5;background:#f1f2f3 center/cover no-repeat;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#8c9196;font-size:15px;font-weight:700}
.rpc-more{width:44px;height:44px;border-radius:10px;background:#eef0f2;color:#4a4f55;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.rpc-names{font-size:12px;color:#4a4f55;line-height:1.4;overflow-wrap:anywhere}
.rpc-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rpc-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:#e3f1df;color:#0c5132;font-size:12px;font-weight:650}
`;

// The reward-products field of a milestone: an empty state that invites adding
// products, or the picked products as thumbnails with an obvious Edit button.
function RewardProductsCard({ ids, catalog, onEdit }) {
  const picked = (ids || []).map((id) => (catalog || []).find((p) => p.id === id)).filter(Boolean);
  const count = (ids || []).length;
  const shown = picked.slice(0, 4);
  const extra = count - shown.length;
  const gift = (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M3 8a1 1 0 011-1h12a1 1 0 011 1v2H3V8zm0 3h6v6H5a2 2 0 01-2-2v-4zm8 0h6v4a2 2 0 01-2 2h-4v-6zM10 7V5.5A2.5 2.5 0 107.5 8H10zm0 0h2.5A2.5 2.5 0 1010 5.5V7z" />
    </svg>
  );
  if (count === 0) {
    return (
      <div className="rpc">
        <style>{REWARD_CARD_CSS}</style>
        <div className="rpc-empty">
          <span className="rpc-ic">{gift}</span>
          <div className="rpc-txt">
            <p className="rpc-title">No reward product yet</p>
            <p className="rpc-sub">Pick the product shoppers get when they reach this milestone.</p>
          </div>
        </div>
        <Button variant="primary" onClick={onEdit}>Add reward products</Button>
      </div>
    );
  }
  return (
    <div className="rpc" data-filled="true">
      <style>{REWARD_CARD_CSS}</style>
      <div className="rpc-thumbs">
        {shown.map((p) => (
          <span key={p.id} className="rpc-thumb" title={p.title} style={p.image ? { backgroundImage: `url("${p.image}")` } : undefined}>
            {!p.image && (p.title || '?').charAt(0).toUpperCase()}
          </span>
        ))}
        {/* Products picked earlier that the loaded catalog doesn't include still count. */}
        {picked.length === 0 && <span className="rpc-ic">{gift}</span>}
        {extra > 0 && <span className="rpc-more">+{extra}</span>}
      </div>
      {picked.length > 0 && (
        <div className="rpc-names">{picked.slice(0, 2).map((p) => p.title).join(', ')}{count > 2 ? ` and ${count - 2} more` : ''}</div>
      )}
      <div className="rpc-actions">
        <span className="rpc-pill">{count} product{count !== 1 ? 's' : ''} selected</span>
        <Button onClick={onEdit}>Edit products</Button>
      </div>
    </div>
  );
}

export function ProgressBarSection() {
  const { body, updateProgressBar, allProducts: catalog } = useCartEditor();
  const { symbol: currencySymbol } = useCurrency();
  const { progressBar } = body;
  const [activeTierIndex, setActiveTierIndex] = useState(0);
  const [pickerTierIndex, setPickerTierIndex] = useState(null);

  const updateTier = (index, updates) => {
    const newTiers = progressBar.tiers.map((t, i) => i === index ? { ...t, ...updates } : t);
    updateProgressBar({ tiers: newTiers });
  };

  const addTier = () => {
    const newTier = {
      id: `tier-${Date.now()}`,
      minimumSpend: progressBar.mode === 'count' ? progressBar.tiers.length + 1 : (progressBar.tiers.length + 1) * 500,
      title: '',
      description: 'Reward',
      icon: 'gift',
      rewardProducts: [],
      rewardProductCount: 0,
      rewardPricing: 'free',
      progressMessage: '',
      completionMessage: '',
      confetti: true,
    };
    const newTiers = [...progressBar.tiers, newTier];
    updateProgressBar({ tiers: newTiers });
    setActiveTierIndex(newTiers.length - 1);
  };

  const removeTier = (index) => {
    const newTiers = progressBar.tiers.filter((_, i) => i !== index);
    updateProgressBar({ tiers: newTiers });
    if (activeTierIndex >= newTiers.length) setActiveTierIndex(Math.max(0, newTiers.length - 1));
  };

  const handleSaveProducts = (selectedIds) => {
    updateTier(pickerTierIndex, {
      rewardProducts: selectedIds,
      rewardProductCount: selectedIds.length,
    });
  };

  const activeTier = progressBar.tiers[activeTierIndex] || progressBar.tiers[0];

  return (
    <CustomizableLockedSection featureKey="progress_bar">
    <BlockStack gap="400">
      <FeatureToggle
        label="Enable Progress Bar"
        enabled={progressBar.enabled}
        onToggle={(v) => updateProgressBar({ enabled: v })}
      />

      <Text as="p" variant="bodyMd" tone="subdued">
        Configure a progress bar that shows customers how close they are to unlocking rewards.
      </Text>

      {progressBar.enabled && (<>
      <Card>
        <FormLayout>
          <Select
            label="Progress mode"
            options={[
              { label: `By amount spent (${currencySymbol})`, value: 'amount' },
              { label: 'By item count', value: 'count' },
            ]}
            value={progressBar.mode}
            onChange={(v) => updateProgressBar({ mode: v })}
          />
          <Select
            label="Position"
            options={[
              { label: 'Top of cart', value: 'top' },
              { label: 'Bottom of cart items', value: 'bottom' },
            ]}
            value={progressBar.position}
            onChange={(v) => updateProgressBar({ position: v })}
          />
          <FeatureToggle
            label="Show progress bar when cart is empty"
            enabled={progressBar.showWhenEmpty}
            onToggle={(v) => updateProgressBar({ showWhenEmpty: v })}
          />
          <FeatureToggle
            label="Hide milestone amount"
            enabled={progressBar.hideMilestoneAmount}
            onToggle={(v) => updateProgressBar({ hideMilestoneAmount: v })}
          />
        </FormLayout>
      </Card>

      <ColorField label="Background color" value={progressBar.colors?.background || '#e5e7eb'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), background: v } })} />
      <ColorField label="Fill color" value={progressBar.colors?.fill || '#10b981'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), fill: v } })} />
      <ColorField label="Icon color" value={progressBar.colors?.icon || '#2563eb'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), icon: v } })} />
      <ColorField label="Message color" value={progressBar.colors?.message || '#10b981'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), message: v } })} />

      <Divider />

      {progressBar.tiers.length === 0 && (
        <Button onClick={addTier}>Add tier</Button>
      )}

      {progressBar.tiers.length > 0 && (
        <>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Tier {activeTierIndex + 1} of {progressBar.tiers.length}</Text>
              <InlineStack gap="200">
                <Button size="slim" onClick={addTier}>Add tier</Button>
                {activeTierIndex > 0 && (
                  <Button size="slim" onClick={() => setActiveTierIndex(activeTierIndex - 1)}>← Prev</Button>
                )}
                {activeTierIndex < progressBar.tiers.length - 1 && (
                  <Button size="slim" onClick={() => setActiveTierIndex(activeTierIndex + 1)}>Next →</Button>
                )}
              </InlineStack>
            </InlineStack>

            <Card>
              <FormLayout>
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm">Tier {activeTierIndex + 1}</Text>
                  {progressBar.tiers.length > 1 && (
                    <Button variant="plain" tone="critical" size="slim" onClick={() => removeTier(activeTierIndex)}>Remove</Button>
                  )}
                </InlineStack>
                <TextField
                  label={progressBar.mode === 'count' ? 'Minimum item count' : `Minimum spend (${currencySymbol})`}
                  type="number"
                  value={String(activeTier.minimumSpend)}
                  onChange={(v) => updateTier(activeTierIndex, { minimumSpend: Number(v) || 0 })}
                  autoComplete="off"
                />
                <TextField
                  label="Tier title (optional)"
                  value={activeTier.title}
                  onChange={(v) => updateTier(activeTierIndex, { title: v })}
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={activeTier.description}
                  onChange={(v) => updateTier(activeTierIndex, { description: v })}
                  autoComplete="off"
                />
                <Select
                  label="Icon"
                  options={[
                    { label: 'Gift', value: 'gift' },
                    { label: 'Shipping', value: 'shipping' },
                    { label: 'Star', value: 'star' },
                    { label: 'Trophy', value: 'trophy' },
                    { label: 'Diamond', value: 'diamond' },
                  ]}
                  value={activeTier.icon}
                  onChange={(v) => updateTier(activeTierIndex, { icon: v })}
                />
                <BlockStack gap="200">
                  <Text as="h4" variant="headingSm">Reward Products</Text>
                  <RewardProductsCard
                    ids={activeTier.rewardProducts}
                    catalog={catalog}
                    onEdit={() => setPickerTierIndex(activeTierIndex)}
                  />
                  {activeTier.rewardProductCount > 0 && (
                    <Select
                      label="Reward price"
                      options={[
                        { label: 'Free (BRIX creates the discount automatically)', value: 'free' },
                        { label: 'Regular price', value: 'regular' },
                      ]}
                      value={activeTier.rewardPricing === 'free' ? 'free' : 'regular'}
                      onChange={(v) => updateTier(activeTierIndex, { rewardPricing: v })}
                      helpText="Free: once the cart reaches this milestone the product is added with a FREE tag and costs nothing at checkout. Regular price: it is added at its normal price."
                    />
                  )}
                </BlockStack>
                {/* Shown while this tier is NOT YET reached — distinct from
                    Completion Message below, which is shown once it IS
                    reached. {amount}/{items}/{target} are filled in
                    dynamically at render time; free text with no
                    placeholders is shown exactly as typed. */}
                <TextField
                  label="Progress Message"
                  value={activeTier.progressMessage || ''}
                  onChange={(v) => updateTier(activeTierIndex, { progressMessage: v })}
                  placeholder={`You're {amount} away from unlocking ${activeTier.title || activeTier.description || 'your reward'}!`}
                  helpText="Available variables: {amount} = remaining amount, {items} = remaining item count, {target} = milestone target"
                  autoComplete="off"
                />
              </FormLayout>
            </Card>
          </BlockStack>

          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Completion</Text>
              {/* Per-tier now — each milestone shows its own congratulations
                  message the moment it's crossed, not one message shared
                  across every tier. Bound to the tier currently selected
                  above (activeTier), same as Title/Description/Icon. */}
              <TextField
                label="Completion Message"
                value={activeTier.completionMessage || ''}
                onChange={(v) => updateTier(activeTierIndex, { completionMessage: v })}
                placeholder={`Congratulations! You've unlocked ${activeTier.title || activeTier.description || 'your reward'}!`}
                autoComplete="off"
              />
              <FeatureToggle
                label="Enable confetti popup on completion"
                enabled={activeTier.confetti !== false}
                onToggle={(v) => updateTier(activeTierIndex, { confetti: v })}
                badge={<ProBadge featureKey="confetti" />}
              />
            </FormLayout>
          </Card>
        </>
      )}

      <ProductPickerModal
        open={pickerTierIndex !== null}
        onClose={() => setPickerTierIndex(null)}
        onSave={handleSaveProducts}
        initialSelectedIds={pickerTierIndex !== null ? progressBar.tiers[pickerTierIndex]?.rewardProducts || [] : []}
        title="Select Reward Products"
      />
      </>)}
    </BlockStack>
    </CustomizableLockedSection>
  );
}
