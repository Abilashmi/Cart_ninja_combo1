import React, { useState } from 'react';
import { Card, FormLayout, TextField, Select, RangeSlider, BlockStack, Text, InlineStack, Button, Divider, Badge } from '@shopify/polaris';
import { GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon, DiscountFilledIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';

const TIER_ICON_MAP = {
  gift: GiftCardFilledIcon,
  shipping: DeliveryFilledIcon,
  star: StarFilledIcon,
  trophy: RewardIcon,
  diamond: DiscountFilledIcon,
};

export function ProgressBarSection() {
  const { body, updateProgressBar } = useCartEditor();
  const { progressBar } = body;
  const [activeTierIndex, setActiveTierIndex] = useState(0);

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

  const updateTier = (index, updates) => {
    const newTiers = progressBar.tiers.map((t, i) => i === index ? { ...t, ...updates } : t);
    updateProgressBar({ tiers: newTiers });
  };

  const removeTier = (index) => {
    const newTiers = progressBar.tiers.filter((_, i) => i !== index);
    updateProgressBar({ tiers: newTiers });
    setActiveTierIndex(Math.min(activeTierIndex, newTiers.length - 1));
  };

  const activeTier = progressBar.tiers[activeTierIndex];

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <FeatureToggle
          label=""
          enabled={progressBar.enabled}
          onToggle={(v) => updateProgressBar({ enabled: v })}
        />
      </InlineStack>
      <Text as="p" variant="bodyMd" tone="subdued">
        Configure milestone rewards and progress tracking to motivate larger orders.
      </Text>

      {progressBar.enabled && (
        <>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Display Settings</Text>
              <FeatureToggle
                label="Show when cart is empty"
                enabled={progressBar.showWhenEmpty}
                onToggle={(v) => updateProgressBar({ showWhenEmpty: v })}
              />
              <Select
                label="Progress Mode"
                options={[
                  { label: 'Cart Amount (₹)', value: 'amount' },
                  { label: 'Product Count', value: 'count' },
                ]}
                value={progressBar.mode}
                onChange={(v) => updateProgressBar({ mode: v })}
              />
              <Select
                label="Position"
                options={[
                  { label: 'Top of Cart', value: 'top' },
                  { label: 'Bottom of Cart', value: 'bottom' },
                ]}
                value={progressBar.position}
                onChange={(v) => updateProgressBar({ position: v })}
              />
              <RangeSlider
                label="Border Radius"
                value={progressBar.borderRadius}
                min={0}
                max={20}
                output
                onChange={(v) => updateProgressBar({ borderRadius: v })}
              />
            </FormLayout>
          </Card>

          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Styling</Text>
              <InlineStack gap="400">
                <ColorField label="Background" value={progressBar.colors.background} onChange={(v) => updateProgressBar({ colors: { ...progressBar.colors, background: v } })} />
                <ColorField label="Fill" value={progressBar.colors.fill} onChange={(v) => updateProgressBar({ colors: { ...progressBar.colors, fill: v } })} />
              </InlineStack>
              <InlineStack gap="400">
                <ColorField label="Subtext Color" value={progressBar.colors.icon} onChange={(v) => updateProgressBar({ colors: { ...progressBar.colors, icon: v } })} />
                <ColorField label="Text Color" value={progressBar.colors.message} onChange={(v) => updateProgressBar({ colors: { ...progressBar.colors, message: v } })} />
              </InlineStack>
            </FormLayout>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">Milestone Tiers</Text>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                {progressBar.tiers.map((tier, index) => (
                  <div key={tier.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                      onClick={() => setActiveTierIndex(index)}
                      style={{
                        padding: '5px 12px',
                        paddingRight: progressBar.tiers.length > 1 ? '24px' : '12px',
                        borderRadius: '6px',
                        border: `1.5px solid ${activeTierIndex === index ? '#008060' : '#c9cccf'}`,
                        background: activeTierIndex === index ? '#f1f8f5' : '#ffffff',
                        color: activeTierIndex === index ? '#008060' : '#202223',
                        fontSize: '13px',
                        fontWeight: activeTierIndex === index ? 600 : 400,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                    >
                      {tier.title || `Tier ${index + 1}`}
                    </button>
                    {progressBar.tiers.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTier(index); }}
                        title="Remove tier"
                        style={{
                          position: 'absolute',
                          right: '5px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: '14px',
                          height: '14px',
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                          color: activeTierIndex === index ? '#008060' : '#8c9196',
                          fontSize: '14px',
                          lineHeight: 1,
                          fontWeight: 700,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {progressBar.tiers.length < 5 && (
                  <button
                    onClick={addTier}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: '1.5px dashed #c9cccf',
                      background: '#ffffff',
                      color: '#6d7175',
                      fontSize: '13px',
                      cursor: 'pointer',
                      fontWeight: 500,
                      transition: 'all 0.15s',
                    }}
                  >
                    + Add
                  </button>
                )}
              </div>

              <Divider />

              {activeTier && (
                <FormLayout>
                  <TextField
                    label={progressBar.mode === 'count' ? 'Minimum Item Count' : 'Minimum Spend'}
                    type="number"
                    value={String(activeTier.minimumSpend)}
                    onChange={(v) => updateTier(activeTierIndex, { minimumSpend: Number(v) })}
                    prefix={progressBar.mode === 'amount' ? '₹' : undefined}
                    suffix={progressBar.mode === 'count' ? 'items' : undefined}
                    autoComplete="off"
                  />
                  <TextField
                    label="Milestone Title"
                    value={activeTier.title}
                    onChange={(v) => updateTier(activeTierIndex, { title: v })}
                    placeholder="e.g., Free Shipping"
                    autoComplete="off"
                  />
                  <TextField
                    label="Description"
                    value={activeTier.description}
                    onChange={(v) => updateTier(activeTierIndex, { description: v })}
                    autoComplete="off"
                  />
                  <BlockStack gap="200">
                    <Select
                      label="Milestone Icon"
                      options={[
                        { label: 'Gift Card', value: 'gift' },
                        { label: 'Delivery', value: 'shipping' },
                        { label: 'Star', value: 'star' },
                        { label: 'Reward', value: 'trophy' },
                        { label: 'Discount', value: 'diamond' },
                      ]}
                      value={activeTier.icon}
                      onChange={(v) => updateTier(activeTierIndex, { icon: v })}
                    />
                    {(() => {
                      const IconComp = TIER_ICON_MAP[activeTier.icon] ?? GiftCardFilledIcon;
                      return (
                        <div style={{
                          padding: '10px 14px',
                          border: '1px solid #e1e3e5',
                          borderRadius: '8px',
                          background: '#f9fafb',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                        }}>
                          <Text as="span" variant="bodySm" tone="subdued">Preview:</Text>
                          <span style={{ color: progressBar.colors.icon, display: 'flex', lineHeight: 0 }}>
                            <IconComp width="22" height="22" fill="currentColor" />
                          </span>
                        </div>
                      );
                    })()}
                  </BlockStack>
                  <BlockStack gap="150">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodySm">Reward Products</Text>
                      <Badge>{`${activeTier.rewardProductCount} of 20 selected`}</Badge>
                    </InlineStack>
                    <Button
                      size="slim"
                      onClick={() => updateTier(activeTierIndex, { rewardProductCount: Math.min(20, activeTier.rewardProductCount + 1) })}
                    >
                      Select Products
                    </Button>
                    {activeTier.rewardProductCount === 0 && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        No products selected. Click "Select Products" to add reward products for this tier.
                      </Text>
                    )}
                  </BlockStack>
                </FormLayout>
              )}
            </BlockStack>
          </Card>

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
              />
            </FormLayout>
          </Card>
        </>
      )}
    </BlockStack>
  );
}
