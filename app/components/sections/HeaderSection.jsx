import React from 'react';
import { Card, FormLayout, TextField, Select, BlockStack, Text, InlineStack } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';

export function HeaderSection() {
  const { header, updateHeader } = useCartEditor();

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Customize the cart drawer header appearance.</Text>
      <Card>
        <FormLayout>
          <TextField
            label="Cart Title"
            value={header.title}
            onChange={(v) => updateHeader({ title: v })}
            autoComplete="off"
          />
          <Select
            label="Close Button Style"
            options={[
              { label: 'Icon (X)', value: 'icon' },
              { label: 'Text (Close)', value: 'text' },
            ]}
            value={header.closeStyle}
            onChange={(v) => updateHeader({ closeStyle: v })}
          />
          <InlineStack gap="400">
            <ColorField
              label="Background Color"
              value={header.bgColor}
              onChange={(v) => updateHeader({ bgColor: v })}
            />
            <ColorField
              label="Text Color"
              value={header.textColor}
              onChange={(v) => updateHeader({ textColor: v })}
            />
          </InlineStack>
          <FeatureToggle
            label="Show bottom border"
            enabled={header.borderBottom}
            onToggle={(v) => updateHeader({ borderBottom: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
