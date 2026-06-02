import React from 'react';
import { Card, FormLayout, TextField, RangeSlider, BlockStack, Text, InlineStack, Select } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { ColorField } from './ColorField';

export function CheckoutSection() {
  const { footer, updateCheckoutButton } = useCartEditor();
  const { checkoutButton } = footer;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Customize the checkout button appearance.
      </Text>
      <Card>
        <FormLayout>
          <TextField
            label="Checkout Button Text"
            value={checkoutButton.text}
            onChange={(v) => updateCheckoutButton({ text: v })}
            autoComplete="off"
          />
          <TextField
            label="Footer Text"
            value={checkoutButton.footerText}
            onChange={(v) => updateCheckoutButton({ footerText: v })}
            autoComplete="off"
            helpText="Text displayed below the checkout button"
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Button Style</Text>
          <InlineStack gap="400">
            <ColorField
              label="Background Color"
              value={checkoutButton.bgColor}
              onChange={(v) => updateCheckoutButton({ bgColor: v })}
            />
            <ColorField
              label="Text Color"
              value={checkoutButton.textColor}
              onChange={(v) => updateCheckoutButton({ textColor: v })}
            />
          </InlineStack>
          <RangeSlider
            label="Border Radius"
            value={checkoutButton.borderRadius}
            min={0}
            max={24}
            output
            suffix="px"
            onChange={(v) => updateCheckoutButton({ borderRadius: v })}
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Mobile Button Type</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Choose how the checkout button behaves on mobile devices.
          </Text>
          <Select
            label="Button type"
            labelHidden
            options={[
              { label: 'Standard — Tap to checkout', value: 'standard' },
              { label: 'Swipe Slider — Swipe to checkout', value: 'swipe' },
            ]}
            value={checkoutButton.mobileButtonType}
            onChange={(v) => updateCheckoutButton({ mobileButtonType: v })}
          />
          {checkoutButton.mobileButtonType === 'swipe' && (
            <div style={{
              pointerEvents: 'none',
              borderRadius: `${checkoutButton.borderRadius}px`,
              background: checkoutButton.bgColor,
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: '42px', height: '42px', margin: '3px',
                borderRadius: `${Math.max(checkoutButton.borderRadius - 2, 4)}px`,
                background: 'rgba(255,255,255,0.92)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                flexShrink: 0, zIndex: 1, position: 'relative',
              }}>
                <span style={{ color: checkoutButton.bgColor, fontSize: '18px', lineHeight: 1 }}>›</span>
              </div>
              <span style={{
                position: 'absolute', left: 0, right: 0,
                textAlign: 'center', color: checkoutButton.textColor,
                fontSize: '13px', fontWeight: 600, letterSpacing: '0.3px',
                pointerEvents: 'none',
              }}>
                Swipe to checkout
              </span>
            </div>
          )}
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
