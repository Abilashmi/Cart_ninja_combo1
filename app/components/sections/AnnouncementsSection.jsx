import React, { useCallback } from 'react';
import { Card, FormLayout, TextField, BlockStack, Text, InlineStack, Checkbox, Select, Button } from '@shopify/polaris';
import { DeleteIcon, PlusIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import {
  ANNOUNCEMENT_INTERVAL_MAX, ANNOUNCEMENT_INTERVAL_MIN, ANNOUNCEMENT_MAX_MESSAGES, clampInterval, cleanMessages,
} from '../../utils/announcement.shared.js';
import { FeatureToggle } from '../shared/FeatureToggle';
import { SliderField } from '../shared/SliderField';
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

  // The list being edited (may hold a blank message just added); `text`
  // always follows the first filled one.
  const editList = Array.isArray(announcements.messages) && announcements.messages.length
    ? announcements.messages
    : [announcements.text || ''];
  const setMessages = (list) => {
    const next = list.length ? list : [''];
    updateAnnouncements({ messages: next, text: cleanMessages(next)[0] || '' });
  };

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
            <BlockStack gap="200">
              {editList.map((msg, i) => (
                <InlineStack key={i} gap="200" blockAlign="end" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={editList.length > 1 ? `Message ${i + 1}` : 'Announcement Text'}
                      value={msg}
                      onChange={(v) => setMessages(editList.map((m, j) => (j === i ? v : m)))}
                      autoComplete="off"
                      multiline={2}
                      maxLength={500}
                    />
                  </div>
                  {editList.length > 1 && (
                    <Button
                      icon={DeleteIcon}
                      accessibilityLabel={`Remove message ${i + 1}`}
                      onClick={() => setMessages(editList.filter((_, j) => j !== i))}
                    />
                  )}
                </InlineStack>
              ))}
              {editList.length < ANNOUNCEMENT_MAX_MESSAGES && (
                <div>
                  <Button icon={PlusIcon} onClick={() => setMessages([...editList, ''])}>Add message</Button>
                </div>
              )}
              {editList.length > 1 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Shoppers see one message at a time{announcements.showArrows !== false ? ' and can move between them with the side arrows' : ''}.
                </Text>
              )}
            </BlockStack>
            {editList.length > 1 && (
              <BlockStack gap="200">
                <Checkbox
                  label="Rotate messages automatically"
                  checked={announcements.autoRotate !== false}
                  onChange={(v) => updateAnnouncements({ autoRotate: v })}
                />
                {announcements.autoRotate !== false && (
                  <SliderField
                    label="Time per message"
                    value={clampInterval(announcements.interval ?? 4)}
                    min={ANNOUNCEMENT_INTERVAL_MIN}
                    max={ANNOUNCEMENT_INTERVAL_MAX}
                    suffix="s"
                    onChange={(v) => updateAnnouncements({ interval: v })}
                  />
                )}
                <Checkbox
                  label="Show side arrows"
                  checked={announcements.showArrows !== false}
                  onChange={(v) => updateAnnouncements({ showArrows: v })}
                />
              </BlockStack>
            )}
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
            <SliderField
              label="Font Size"
              value={announcements.fontSize}
              min={10}
              max={20}
              suffix="px"
              onChange={(v) => updateAnnouncements({ fontSize: v })}
            />
            <InlineStack gap="400" blockAlign="end">
              <div style={{ flex: 1 }}>
                <Select
                  label="Text alignment"
                  options={[
                    { label: 'Left', value: 'left' },
                    { label: 'Center', value: 'center' },
                    { label: 'Right', value: 'right' },
                  ]}
                  value={announcements.textAlign}
                  onChange={(v) => updateAnnouncements({ textAlign: v })}
                />
              </div>
              <InlineStack gap="400" blockAlign="center">
                <Checkbox
                  label="Bold"
                  checked={announcements.bold}
                  onChange={(v) => updateAnnouncements({ bold: v })}
                />
                <Checkbox
                  label="Italic"
                  checked={announcements.italic}
                  onChange={(v) => updateAnnouncements({ italic: v })}
                />
              </InlineStack>
            </InlineStack>
          </FormLayout>
        </Card>
      )}
    </BlockStack>
  );
}
