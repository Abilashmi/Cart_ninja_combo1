import React, { useCallback } from 'react';
import { Card, FormLayout, TextField, RangeSlider, BlockStack, Text, InlineStack } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { ColorField } from './ColorField';

export function AnnouncementsSection() {
  const { body, updateAnnouncements } = useCartEditor();
  const { announcements } = body;

  // Auto-save the enabled flag immediately so the DB reflects the toggle state
  // without waiting for the global Save button (avoids stale-closure race).
  const handleToggle = useCallback(async (v) => {
    updateAnnouncements({ enabled: v });
    try {
      await fetch('/api/cart-drawer-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement_enabled: v ? 1 : 0 }),
      });
    } catch { /* network error — global Save will catch it */ }
  }, [updateAnnouncements]);

  return (
    <BlockStack gap="400">
      <FeatureToggle
        label="Enable Announcements"
        enabled={announcements.enabled}
        onToggle={handleToggle}
      />
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
