import React from 'react';
import { Card, FormLayout, TextField, RangeSlider, BlockStack, Text, InlineStack } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';

export function AnnouncementsSection() {
  const { body, updateAnnouncements } = useCartEditor();
  const { announcements } = body;

  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <FeatureToggle
          label=""
          enabled={announcements.enabled}
          onToggle={(v) => updateAnnouncements({ enabled: v })}
        />
      </InlineStack>
      <Text as="p" variant="bodyMd" tone="subdued">
        Display a promotional banner at the top of your cart drawer.
      </Text>
      {announcements.enabled && (
        <Card>
          <FormLayout>
            <TextField
              label="Announcement Text"
              value={announcements.text}
              onChange={(v) => updateAnnouncements({ text: v })}
              autoComplete="off"
              multiline={2}
            />
            <InlineStack gap="400">
              <ColorField
                label="Background Color"
                value={announcements.bgColor}
                onChange={(v) => updateAnnouncements({ bgColor: v })}
              />
              <ColorField
                label="Text Color"
                value={announcements.textColor}
                onChange={(v) => updateAnnouncements({ textColor: v })}
              />
            </InlineStack>
            <RangeSlider
              label="Font Size"
              value={announcements.fontSize}
              min={10}
              max={20}
              output
              suffix="px"
              onChange={(v) => updateAnnouncements({ fontSize: v })}
            />
          </FormLayout>
        </Card>
      )}
    </BlockStack>
  );
}
