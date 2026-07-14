import React from 'react';
import { Card, FormLayout, TextField, BlockStack, Text, InlineStack, Select } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { ColorField } from './ColorField';
import { SliderField } from '../shared/SliderField';
import { CustomizableLockedSection } from '../plan/PlanGate';

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
          <SliderField
            label="Border Radius"
            value={checkoutButton.borderRadius}
            min={0}
            max={24}
            suffix="px"
            onChange={(v) => updateCheckoutButton({ borderRadius: v })}
          />
        </FormLayout>
      </Card>
      <CustomizableLockedSection featureKey="mobile_swipe_checkout">
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
            <Text as="p" variant="bodySm" tone="subdued">
              Switch the live preview to mobile view to see the swipe button.
            </Text>
          )}
        </FormLayout>
      </Card>
      </CustomizableLockedSection>
    </BlockStack>
  );
}
