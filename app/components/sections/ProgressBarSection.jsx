import React, { useState, useEffect, useCallback } from 'react';
import { Card, FormLayout, TextField, Select, BlockStack, Text, InlineStack, Button, Divider, Badge, Modal } from '@shopify/polaris';
import { GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon, DiscountFilledIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
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

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <Modal open={open} onClose={onClose} title={title || 'Select Products'}
      primaryAction={{ content: 'Save Selection', onAction: () => { onSave(selectedIds); onClose(); } }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd" tone="subdued">Select products for this reward milestone.</Text>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>
              {allProducts.map(product => {
                const isSelected = selectedIds.includes(product.id);
                return (
                  <div key={product.id} onClick={() => toggle(product.id)}
                    style={{
                      padding: '8px 10px', border: isSelected ? '2px solid #2c6ecb' : '1px solid #e5e7eb',
                      borderRadius: '8px', background: isSelected ? '#f0f7ff' : '#fff',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '6px', overflow: 'hidden',
                      flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f8fafc', border: '1px solid #f1f5f9',
                    }}>
                      {product.image ? (
                        <img src={product.image} alt={product.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span>📦</span>
                      )}
                    </div>
                    <BlockStack gap="050" style={{ flex: 1, minWidth: 0 }}>
                      <Text fontWeight="bold" variant="bodySm">{product.title}</Text>
                      <Text tone="subdued" variant="bodyXs">{currencySymbol}{product.price}</Text>
                    </BlockStack>
                    {isSelected && <span style={{ color: '#2c6ecb', fontSize: '18px', fontWeight: 700 }}>✓</span>}
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

export function ProgressBarSection() {
  const { body, updateProgressBar } = useCartEditor();
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
      minimumSpend: (progressBar.tiers.length + 1) * 500,
      title: '',
      description: 'Reward',
      icon: 'gift',
      rewardProducts: [],
      rewardProductCount: 0,
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
        </FormLayout>
      </Card>

      <ColorField label="Background color" value={progressBar.colors?.background || '#e5e7eb'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), background: v } })} />
      <ColorField label="Fill color" value={progressBar.colors?.fill || '#10b981'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), fill: v } })} />
      <ColorField label="Icon color" value={progressBar.colors?.icon || '#2563eb'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), icon: v } })} />
      <ColorField label="Message color" value={progressBar.colors?.message || '#10b981'} onChange={(v) => updateProgressBar({ colors: { ...(progressBar.colors || {}), message: v } })} />

      <Divider />

      {progressBar.tiers.length > 0 && (
        <>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Tier {activeTierIndex + 1} of {progressBar.tiers.length}</Text>
              <InlineStack gap="200">
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
                  label={`Minimum spend (${currencySymbol})`}
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
                  <Button onClick={() => setPickerTierIndex(activeTierIndex)}>
                    {activeTier.rewardProductCount > 0
                      ? `Edit Products (${activeTier.rewardProductCount} selected)`
                      : 'Select Products'}
                  </Button>
                  <div style={{ cursor: 'pointer', color: '#2c6ecb', textDecoration: 'underline', fontSize: '13px' }} onClick={() => setPickerTierIndex(activeTierIndex)}>
                    {activeTier.rewardProductCount > 0
                      ? `${activeTier.rewardProductCount} product${activeTier.rewardProductCount !== 1 ? 's' : ''} selected. Click to modify.`
                      : 'No products selected. Click to add reward products.'}
                  </div>
                </BlockStack>
              </FormLayout>
            </Card>
          </BlockStack>

          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Completion</Text>
              <TextField
                label="Completion Message"
                value={progressBar.completionMessage}
                onChange={(v) => updateProgressBar({ completionMessage: v })}
                autoComplete="off"
              />
              <FeatureToggle
                label="Enable confetti popup on completion"
                enabled={progressBar.confetti}
                onToggle={(v) => updateProgressBar({ confetti: v })}
                badge={<ProBadge featureKey="confetti" />}
              />
            </FormLayout>
          </Card>
        </>
      )}

      <Button onClick={addTier}>Add tier</Button>

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
