import React from 'react';
import { Card, FormLayout, Select, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';

export function GeneralSection() {
  const { settings, updateGeneral } = useCartEditor();
  const { general } = settings;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Configure how the cart drawer behaves on your store.</Text>
      <Card>
        <FormLayout>
          <FeatureToggle
            label="Open Cart Drawer when an item is added to the cart"
            enabled={general.openOnAdd}
            onToggle={(v) => updateGeneral({ openOnAdd: v })}
          />
          <FeatureToggle
            label="Open Cart Drawer when the cart icon is clicked"
            enabled={general.openOnIconClick}
            onToggle={(v) => updateGeneral({ openOnIconClick: v })}
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
