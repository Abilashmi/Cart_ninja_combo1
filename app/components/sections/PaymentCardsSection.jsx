import React from 'react';
import { Card, FormLayout, TextField, BlockStack, Text, InlineStack, Select, Checkbox, Button, Divider } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { ColorField } from './ColorField';
import { SliderField } from '../shared/SliderField';
import { footerExtras } from '../../utils/cart-footer-extras.shared';

const TYPE_OPTIONS = [
  { label: 'Card logo', value: 'brand' },
  { label: 'Image link', value: 'image' },
  { label: 'Text', value: 'text' },
];

// Cart Editor → Cards: the row of payment logos / typed text under Checkout.
export function PaymentCardsSection() {
  const { footer, updatePaymentCards } = useCartEditor();
  const cards = footer.paymentCards;
  const items = cards.items || [];
  const hasText = items.some((i) => i.type === 'text');

  const setItems = (next) => updatePaymentCards({ items: next });
  const patchItem = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const changeType = (id, type) => {
    const base = { id, type };
    if (type === 'brand') Object.assign(base, { brand: 'visa' });
    if (type === 'image') Object.assign(base, { src: '' });
    if (type === 'text') Object.assign(base, { text: '' });
    setItems(items.map((i) => (i.id === id ? base : i)));
  };
  const addItem = () => {
    const used = items.filter((i) => i.type === 'brand').map((i) => i.brand);
    const next = footerExtras.BRAND_OPTIONS.find((b) => !used.includes(b.value));
    setItems([...items, { id: `c${Date.now().toString(36)}`, type: 'brand', brand: next ? next.value : 'visa' }]);
  };

  // The same HTML the storefront draws, from the checked config. Draft rows with
  // nothing typed yet are left out of it by the config check.
  const previewHtml = footerExtras.cardsHtml({ ...footerExtras.cardsConfig({ ...cards, items }), enabled: true });

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Show the cards you accept (Visa, Mastercard…) or your own text under the Checkout button.
      </Text>
      <Card>
        <FormLayout>
          <Checkbox
            label="Show cards under the Checkout button"
            checked={cards.enabled === true}
            onChange={(v) => updatePaymentCards({ enabled: v })}
          />
        </FormLayout>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">Cards</Text>
          {previewHtml && (
            <div style={{ padding: 10, border: '1px dashed #c9cccf', borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
          {items.map((item, index) => (
            <BlockStack key={item.id} gap="200">
              {index > 0 && <Divider />}
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <div style={{ width: 130, flexShrink: 0 }}>
                  <Select label="Type" options={TYPE_OPTIONS} value={item.type} onChange={(v) => changeType(item.id, v)} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {item.type === 'brand' && (
                    <Select label="Card" options={footerExtras.BRAND_OPTIONS} value={item.brand} onChange={(v) => patchItem(item.id, { brand: v })} />
                  )}
                  {item.type === 'image' && (
                    <TextField
                      label="Image link (https)"
                      value={item.src || ''}
                      onChange={(v) => patchItem(item.id, { src: v })}
                      placeholder="https://…/visa.png"
                      autoComplete="off"
                    />
                  )}
                  {item.type === 'text' && (
                    <TextField
                      label="Text"
                      value={item.text || ''}
                      onChange={(v) => patchItem(item.id, { text: v })}
                      maxLength={24}
                      autoComplete="off"
                    />
                  )}
                </div>
                <Button tone="critical" variant="plain" onClick={() => setItems(items.filter((i) => i.id !== item.id))}>Remove</Button>
              </InlineStack>
            </BlockStack>
          ))}
          {items.length < footerExtras.MAX_CARDS && (
            <div><Button onClick={addItem}>Add a card</Button></div>
          )}
        </BlockStack>
      </Card>

      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Style</Text>
          <Select
            label="Alignment"
            options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }]}
            value={cards.align}
            onChange={(v) => updatePaymentCards({ align: v })}
          />
          <SliderField label="Size (height)" value={cards.height} min={14} max={48} suffix="px" onChange={(v) => updatePaymentCards({ height: v })} />
          <SliderField label="Space between cards" value={cards.gap} min={2} max={24} suffix="px" onChange={(v) => updatePaymentCards({ gap: v })} />
          <SliderField label="Space above" value={cards.marginTop} min={0} max={40} suffix="px" onChange={(v) => updatePaymentCards({ marginTop: v })} />
          {hasText && (
            <>
              <SliderField label="Text size" value={cards.textSize} min={9} max={20} suffix="px" onChange={(v) => updatePaymentCards({ textSize: v })} />
              <InlineStack gap="400">
                <ColorField label="Text colour" value={cards.textColor} onChange={(v) => updatePaymentCards({ textColor: v })} />
                <ColorField label="Text background" value={cards.textBg} allowEmpty fallback="#f3f4f6" onChange={(v) => updatePaymentCards({ textBg: v })} />
              </InlineStack>
            </>
          )}
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
