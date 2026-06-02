import React from 'react';
import { Card, FormLayout, Checkbox, Select, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';

export function GeneralSection() {
  const { settings, updateGeneral } = useCartEditor();
  const { general } = settings;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Configure how the cart drawer behaves on your store.</Text>
      <Card>
        <FormLayout>
          <Checkbox
            label="Open Cart Drawer when an item is added to the cart"
            checked={general.openOnAdd}
            onChange={(v) => updateGeneral({ openOnAdd: v })}
          />
          <Checkbox
            label="Open Cart Drawer when the cart icon is clicked"
            checked={general.openOnIconClick}
            onChange={(v) => updateGeneral({ openOnIconClick: v })}
          />
          <Checkbox
            label='Show "Continue shopping" button'
            checked={general.showContinueShopping}
            onChange={(v) => updateGeneral({ showContinueShopping: v })}
          />
          <Select
            label="Cart Drawer Position"
            options={[
              { label: 'Right side', value: 'right' },
              { label: 'Left side', value: 'left' },
            ]}
            value={general.position}
            onChange={(v) => updateGeneral({ position: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
