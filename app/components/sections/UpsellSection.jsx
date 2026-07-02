import React, { useState, useEffect, useCallback } from 'react';
import { FormLayout, TextField, Select, BlockStack, Text, InlineStack, Button, Icon, Divider, Card, Modal } from '@shopify/polaris';
import { MagicIcon, SettingsIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';
import { CustomizableLockedSection } from '../plan/PlanGate';

const CONFIG_OPTIONS = [
  { value: 'ai', label: 'AI Recommendations', desc: 'Let AI automatically suggest relevant products based on cart contents', icon: MagicIcon },
  { value: 'manual', label: 'Manual Selection', desc: 'Hand-pick exactly which products to show as upsells', icon: SettingsIcon },
];

const MOCK_AI_SUGGESTIONS = [
  { id: 'ai-1', name: 'Organic Turmeric Face Pack', reason: 'Combines well with the White Kasturi Manjal to create a complete skincare routine.', description: 'A natural face pack that enhances the benefits of White Kasturi Manjal for a radiant glow.', priceRange: '₹150–₹300' },
  { id: 'ai-2', name: 'Ayurvedic Skincare Oil', reason: 'Perfectly pairs with White Kasturi Manjal to enhance hydration and overall skin health.', description: 'A nourishing oil that complements your skincare ritual, promoting healthy skin.', priceRange: '₹250–₹500' },
  { id: 'ai-3', name: 'Herbal Cleansing Brush', reason: 'Enhances the application and effectiveness of White Kasturi Manjal for deeper cleansing.', description: 'A gentle cleansing brush designed to effectively use with herbal products.', priceRange: '₹100–₹200' },
];

const PRODUCT_CACHE_KEY = 'cached_products';

function ProductPickerModal({ open, onClose, onSave, initialSelectedIds, title }) {
  const { allProducts: contextProducts } = useCartEditor();
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
      try { sessionStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(contextProducts)); } catch {}
      setInitialized(true);
      return;
    }
    const cached = sessionStorage.getItem(PRODUCT_CACHE_KEY);
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
          try { sessionStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(products)); } catch {}
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

  const toggle = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Modal open={open} onClose={onClose} title={title || 'Select Products'}
      primaryAction={{ content: 'Save Selection', onAction: () => { onSave(selectedIds); onClose(); } }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd" tone="subdued">Select products.</Text>
          {loading ? (
            <Text as="p" variant="bodyMd">Loading products...</Text>
          ) : fetchError ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="critical">Failed to load products.</Text>
              <Button size="slim" onClick={() => { setLoading(true); setFetchError(false); fetch('/api/upsell').then(r=>r.json()).then(data=>{if (!data?.success) { setFetchError(true); setAllProducts([]); setLoading(false); return; } setAllProducts(data?.data?.allProducts || []); try { sessionStorage.setItem(PRODUCT_CACHE_KEY, JSON.stringify(data?.data?.allProducts || [])); } catch {} setLoading(false); }).catch(()=>{ setFetchError(true); setLoading(false); }) }}>Retry</Button>
            </BlockStack>
          ) : allProducts.length === 0 ? (
            <Text as="p" variant="bodyMd" tone="subdued">No products found. Make sure your store has products.</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' }}>
              {allProducts.map(product => {
                const sel = selectedIds.includes(product.id);
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

function LimitPicker({ value, onChange }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm">Max upsells to show</Text>
      <InlineStack gap="150">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            style={{
              width: '32px', height: '32px', borderRadius: '6px', border: '1.5px solid',
              borderColor: value === n ? '#008060' : '#c9cccf',
              background: value === n ? '#008060' : '#ffffff',
              color: value === n ? '#ffffff' : '#202223',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {n}
          </button>
        ))}
      </InlineStack>
    </BlockStack>
  );
}

export function UpsellSection() {
  const { body, updateUpsellProducts, addUpsellRule, removeUpsellRule, updateUpsellRule } = useCartEditor();
  const { upsellProducts } = body;
  const [configMode, setConfigMode] = useState(upsellProducts.useAI ? 'ai' : 'manual');
  const [pickerConfig, setPickerConfig] = useState(null);

  const handleModeChange = (mode) => {
    setConfigMode(mode);
    updateUpsellProducts({ useAI: mode === 'ai' });
  };

  const addRule = () => {
    const newRule = {
      id: `rule-${Date.now()}`,
      triggerProductCount: 1,
      triggerProductIds: [],
      upsellProductCount: 1,
      upsellProductIds: [],
    };
    addUpsellRule(newRule);
  };

  const closePicker = () => setPickerConfig(null);

  return (
    <CustomizableLockedSection featureKey="ai_cart_upsell">
    <BlockStack gap="400">
      <FeatureToggle
        label="Enable Upsell Products"
        enabled={upsellProducts.enabled}
        onToggle={(v) => updateUpsellProducts({ enabled: v })}
      />
      <Text as="p" variant="bodyMd" tone="subdued">
        Configure how upsell products appear in the cart drawer.
      </Text>

      {upsellProducts.enabled && (
        <BlockStack gap="400">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Configuration Mode</Text>
            <BlockStack gap="200">
              {CONFIG_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => handleModeChange(opt.value)}
                  style={{
                    padding: '14px 16px', borderRadius: '8px', cursor: 'pointer',
                    border: `1.5px solid ${configMode === opt.value ? '#008060' : '#e1e3e5'}`,
                    background: configMode === opt.value ? '#f1f8f5' : '#ffffff',
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                  }}
                >
                  <input type="radio" readOnly checked={configMode === opt.value} style={{ marginTop: '3px', accentColor: '#008060', cursor: 'pointer', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ display: 'flex', flexShrink: 0 }}><Icon source={opt.icon} /></span>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: '#202223' }}>{opt.label}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: '#6d7175', lineHeight: '1.5' }}>{opt.desc}</p>
                  </div>
                </div>
              ))}
            </BlockStack>
          </BlockStack>

          <Divider />

          {configMode === 'ai' && (
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">AI Settings</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  AI analyses cart contents in real-time and picks the most relevant upsell products automatically.
                </Text>
              </BlockStack>
              <LimitPicker value={upsellProducts.limit} onChange={(v) => updateUpsellProducts({ limit: v })} />
              <InlineStack gap="200">
                <Button variant="primary">Configure AI</Button>
              </InlineStack>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingMd">Upsell Suggestions</Text>
                      <Text as="p" variant="bodySm" tone="subdued">AI-generated recommendations (server-side).</Text>
                    </BlockStack>
                    <Button>Regenerate Suggestions</Button>
                  </InlineStack>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {MOCK_AI_SUGGESTIONS.map((product) => (
                      <div key={product.id} style={{ padding: '12px 14px', border: '1px solid #e1e3e5', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{product.name}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{product.reason}</Text>
                        <Text as="p" variant="bodySm">{product.description}</Text>
                        <Text as="p" variant="bodySm" fontWeight="semibold">{product.priceRange}</Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>
            </BlockStack>
          )}

          {configMode === 'manual' && (
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Manual Upsell Rules</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Configure product-specific recommendation rules. Rules are matched top-to-bottom.
                </Text>
              </BlockStack>
              <LimitPicker value={upsellProducts.limit} onChange={(v) => updateUpsellProducts({ limit: v })} />
              <BlockStack gap="200">
                {upsellProducts.manualRules.map((rule, index) => (
                  <div key={rule.id} style={{ border: '1px solid #e1e3e5', borderRadius: '8px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #e1e3e5', background: '#f9fafb' }}>
                      <Text as="span" variant="bodySm" fontWeight="semibold">Rule #{index + 1}</Text>
                      <Button variant="plain" tone="critical" size="slim" onClick={() => removeUpsellRule(rule.id)}>Remove</Button>
                    </div>
                    <div style={{ padding: '12px 14px' }}>
                      <BlockStack gap="200">
                        <div>
                          <Text as="p" variant="bodySm" tone="subdued">If this product is in cart:</Text>
                          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #c9cccf', background: '#ffffff', fontSize: '13px', color: '#202223' }}>
                              {rule.triggerProductIds?.length > 0
                                ? `${rule.triggerProductIds.length} product${rule.triggerProductIds.length !== 1 ? 's' : ''} selected`
                                : `${rule.triggerProductCount} Trigger Product${rule.triggerProductCount !== 1 ? 's' : ''}`}
                            </div>
                            <Button size="slim" onClick={() => setPickerConfig({ ruleId: rule.id, type: 'trigger', selectedIds: rule.triggerProductIds || [] })}>Select</Button>
                          </div>
                        </div>
                        <div>
                          <Text as="p" variant="bodySm" tone="subdued">Then recommend these products:</Text>
                          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #c9cccf', background: '#ffffff', fontSize: '13px', color: '#202223' }}>
                              {rule.upsellProductIds?.length > 0
                                ? `${rule.upsellProductIds.length} product${rule.upsellProductIds.length !== 1 ? 's' : ''} selected`
                                : `${rule.upsellProductCount} Upsell Product${rule.upsellProductCount !== 1 ? 's' : ''}`}
                            </div>
                            <Button size="slim" onClick={() => setPickerConfig({ ruleId: rule.id, type: 'upsell', selectedIds: rule.upsellProductIds || [] })}>Select</Button>
                          </div>
                        </div>
                      </BlockStack>
                    </div>
                  </div>
                ))}
                {upsellProducts.manualRules.length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed #c9cccf', borderRadius: '8px' }}>
                    <Text as="p" variant="bodySm" tone="subdued">No rules yet. Add a rule to get started.</Text>
                  </div>
                )}
                <Button onClick={addRule}>Add new rule</Button>
              </BlockStack>
            </BlockStack>
          )}

          <Divider />

          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Upsell Settings</Text>
            <FormLayout>
              <FeatureToggle label="Show when cart is empty" enabled={upsellProducts.showWhenEmpty} onToggle={(v) => updateUpsellProducts({ showWhenEmpty: v })} />
              <FeatureToggle label="Show upsell offer if item already in cart" enabled={upsellProducts.showIfInCart} onToggle={(v) => updateUpsellProducts({ showIfInCart: v })} />
              <FeatureToggle label="Show product reviews on upsells" enabled={upsellProducts.showReviews} onToggle={(v) => updateUpsellProducts({ showReviews: v })} />
            </FormLayout>
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Display Settings</Text>
            <FormLayout>
              <Select
                label="Upsell position"
                options={[
                  { label: 'Top of cart items', value: 'top' },
                  { label: 'Bottom of cart items', value: 'bottom' },
                ]}
                value={upsellProducts.position}
                onChange={(v) => updateUpsellProducts({ position: v })}
              />
              <Select
                label="Upsell direction"
                options={[
                  { label: 'Horizontal', value: 'horizontal' },
                  { label: 'Vertical', value: 'vertical' },
                ]}
                value={upsellProducts.direction}
                onChange={(v) => updateUpsellProducts({ direction: v })}
              />
              <Select
                label="Layout"
                options={[
                  { label: 'Carousel (Scrollable)', value: 'carousel' },
                  { label: 'Grid (2 Columns)', value: 'grid' },
                ]}
                value={upsellProducts.layout}
                onChange={(v) => updateUpsellProducts({ layout: v })}
              />
            </FormLayout>
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Content</Text>
            <FormLayout>
              <TextField label="Upsell title" value={upsellProducts.title} onChange={(v) => updateUpsellProducts({ title: v })} autoComplete="off" />
              <ColorField label="Title color" value={upsellProducts.titleColor} onChange={(v) => updateUpsellProducts({ titleColor: v })} />
              <TextField label="Button text" value={upsellProducts.buttonText} onChange={(v) => updateUpsellProducts({ buttonText: v })} autoComplete="off" />
            </FormLayout>
          </BlockStack>
        </BlockStack>
      )}

      <ProductPickerModal
        open={pickerConfig !== null}
        onClose={closePicker}
        onSave={(selectedIds) => {
          if (pickerConfig) {
            const key = pickerConfig.type === 'trigger' ? 'triggerProductIds' : 'upsellProductIds';
            const countKey = pickerConfig.type === 'trigger' ? 'triggerProductCount' : 'upsellProductCount';
            updateUpsellRule(pickerConfig.ruleId, {
              [key]: selectedIds,
              [countKey]: selectedIds.length,
            });
          }
          closePicker();
        }}
        initialSelectedIds={pickerConfig?.selectedIds || []}
        title={pickerConfig?.type === 'trigger' ? 'Select Trigger Products' : 'Select Upsell Products'}
      />
    </BlockStack>
    </CustomizableLockedSection>
  );
}
