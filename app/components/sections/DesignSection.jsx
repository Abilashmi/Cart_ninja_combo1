import React from 'react';
import { Card, FormLayout, Select, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { SliderField } from '../shared/SliderField';

export function DesignSection() {
  const { settings, updateDesign } = useCartEditor();
  const { design } = settings;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Configure the visual appearance of your cart drawer.</Text>
      <Card>
        <FormLayout>
          <Select
            label="Cart Width"
            options={[
              { label: 'Slim', value: 'slim' },
              { label: 'Normal', value: 'normal' },
              { label: 'Thick', value: 'thick' },
            ]}
            value={design.width}
            onChange={(v) => updateDesign({ width: v })}
          />
          <SliderField
            label="Border Radius"
            value={design.borderRadius}
            min={0}
            max={24}
            suffix="px"
            onChange={(v) => updateDesign({ borderRadius: v })}
          />
          <FeatureToggle
            label="Drop Shadow"
            enabled={design.shadow}
            onToggle={(v) => updateDesign({ shadow: v })}
          />
          <Select
            label="Open Animation"
            options={[
              { label: 'Slide', value: 'slide' },
              { label: 'Fade', value: 'fade' },
              { label: 'Bounce', value: 'bounce' },
              { label: 'Zoom', value: 'zoom' },
              { label: 'Push', value: 'push' },
              { label: 'None', value: 'none' },
            ]}
            value={design.animation}
            onChange={(v) => updateDesign({ animation: v })}
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
