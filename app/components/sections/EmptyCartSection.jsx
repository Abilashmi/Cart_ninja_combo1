import React from 'react';
import { Card, FormLayout, TextField, Checkbox, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';

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
          <Checkbox
            label='Show "Continue shopping" button'
            checked={emptyCart.showContinueShopping}
            onChange={(v) => updateEmptyCart({ showContinueShopping: v })}
          />
          <Checkbox
            label="Show recommended products"
            checked={emptyCart.showRecommendations}
            onChange={(v) => updateEmptyCart({ showRecommendations: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
