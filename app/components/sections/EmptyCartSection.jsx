import React from 'react';
import { Card, FormLayout, TextField, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';

export function EmptyCartSection() {
  const { body, updateEmptyCart } = useCartEditor();
  const { emptyCart } = body;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Configure what customers see when their cart is empty.
      </Text>
      <Card>
        <FormLayout>
          <TextField
            label="Empty Cart Message"
            value={emptyCart.message}
            onChange={(v) => updateEmptyCart({ message: v })}
            autoComplete="off"
          />
          <FeatureToggle
            label='Show "Continue shopping" button'
            enabled={emptyCart.showContinueShopping}
            onToggle={(v) => updateEmptyCart({ showContinueShopping: v })}
          />
          <FeatureToggle
            label="Show recommended products"
            enabled={emptyCart.showRecommendations}
            onToggle={(v) => updateEmptyCart({ showRecommendations: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
