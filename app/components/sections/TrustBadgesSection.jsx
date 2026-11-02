import React from 'react';
import { Card, FormLayout, TextField, BlockStack, Text, InlineStack, Select, Checkbox, Button, Divider } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { ColorField } from './ColorField';
import { SliderField } from '../shared/SliderField';
import { footerExtras } from '../../utils/cart-footer-extras.shared';

// Cart Editor → Trust Badges: icon + title + line, under the Checkout button.
export function TrustBadgesSection() {
  const { footer, updateTrustBadges } = useCartEditor();
  const trust = footer.trustBadges;
  const items = trust.items || [];

  const setItems = (next) => updateTrustBadges({ items: next });
  const patchItem = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const addItem = () => setItems([...items, { id: `t${Date.now().toString(36)}`, icon: 'check', title: '', subtitle: '' }]);

  const previewHtml = footerExtras.trustHtml({ ...footerExtras.trustConfig({ ...trust, items }), enabled: true });

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Reassure shoppers with up to {footerExtras.MAX_BADGES} badges, each with an icon, a title and a short line.
      </Text>
      <Card>
        <FormLayout>
          <Checkbox
            label="Show trust badges under the Checkout button"
            checked={trust.enabled === true}
            onChange={(v) => updateTrustBadges({ enabled: v })}
          />
        </FormLayout>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Badges</Text>
          {previewHtml && (
            <div style={{ padding: 6, border: '1px dashed #c9cccf', borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
          {items.map((item, index) => (
            <BlockStack key={item.id} gap="200">
              {index > 0 && <Divider />}
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <div style={{ width: 150, flexShrink: 0 }}>
                  <Select label="Icon" options={footerExtras.ICON_OPTIONS} value={item.icon} onChange={(v) => patchItem(item.id, { icon: v })} />
                </div>
                <Button tone="critical" variant="plain" onClick={() => setItems(items.filter((i) => i.id !== item.id))}>Remove</Button>
              </InlineStack>
              <TextField label="Title" value={item.title || ''} onChange={(v) => patchItem(item.id, { title: v })} maxLength={40} autoComplete="off" />
              <TextField label="Line under the title" value={item.subtitle || ''} onChange={(v) => patchItem(item.id, { subtitle: v })} maxLength={60} autoComplete="off" />
              <TextField
                label="Own icon image link (optional, https)"
                value={item.iconImage || ''}
                onChange={(v) => patchItem(item.id, { iconImage: v })}
                helpText="Replaces the icon above."
                autoComplete="off"
              />
            </BlockStack>
          ))}
          {items.length < footerExtras.MAX_BADGES && (
            <div><Button onClick={addItem}>Add a badge</Button></div>
          )}
        </BlockStack>
      </Card>

      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Style</Text>
          <Select
            label="Layout"
            options={[{ label: 'Icon above text', value: 'stacked' }, { label: 'Icon beside text', value: 'inline' }]}
            value={trust.layout}
            onChange={(v) => updateTrustBadges({ layout: v })}
          />
          <SliderField label="Icon size" value={trust.iconSize} min={12} max={56} suffix="px" onChange={(v) => updateTrustBadges({ iconSize: v })} />
          <InlineStack gap="400">
            <ColorField label="Icon colour" value={trust.iconColor} onChange={(v) => updateTrustBadges({ iconColor: v })} />
            <ColorField label="Title colour" value={trust.titleColor} onChange={(v) => updateTrustBadges({ titleColor: v })} />
            <ColorField label="Line colour" value={trust.subColor} onChange={(v) => updateTrustBadges({ subColor: v })} />
          </InlineStack>
          <SliderField label="Title size" value={trust.titleSize} min={8} max={20} suffix="px" onChange={(v) => updateTrustBadges({ titleSize: v })} />
          <SliderField label="Line size" value={trust.subSize} min={8} max={18} suffix="px" onChange={(v) => updateTrustBadges({ subSize: v })} />
          <Checkbox label="Bold title" checked={trust.titleBold !== false} onChange={(v) => updateTrustBadges({ titleBold: v })} />
          <InlineStack gap="400">
            <ColorField label="Background" value={trust.bgColor} allowEmpty fallback="#f9fafb" onChange={(v) => updateTrustBadges({ bgColor: v })} />
            <ColorField label="Border" value={trust.borderColor} allowEmpty fallback="#e5e7eb" onChange={(v) => updateTrustBadges({ borderColor: v })} />
          </InlineStack>
          <SliderField label="Corner radius" value={trust.radius} min={0} max={24} suffix="px" onChange={(v) => updateTrustBadges({ radius: v })} />
          <SliderField label="Padding" value={trust.padding} min={0} max={24} suffix="px" onChange={(v) => updateTrustBadges({ padding: v })} />
          <SliderField label="Space between badges" value={trust.gap} min={0} max={32} suffix="px" onChange={(v) => updateTrustBadges({ gap: v })} />
          <SliderField label="Space above" value={trust.marginTop} min={0} max={40} suffix="px" onChange={(v) => updateTrustBadges({ marginTop: v })} />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
