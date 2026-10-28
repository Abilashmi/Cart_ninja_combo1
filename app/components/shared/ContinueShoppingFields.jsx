import React from 'react';
import { Card, FormLayout, TextField, Checkbox, Select, Text, InlineStack, BlockStack } from '@shopify/polaris';
import { ColorField } from './ColorField';
import { SliderField } from './SliderField';
import { CONTINUE_LIMITS, isValidContinueUrl, sanitizeContinueShopping } from '../../utils/continue-shopping.shared.js';

const STYLE_OPTIONS = [
  { label: 'Outline button', value: 'outline' },
  { label: 'Filled button', value: 'filled' },
  { label: 'Text link', value: 'link' },
];

const ACTION_OPTIONS = [
  { label: 'Close the cart (stay on the page)', value: 'close' },
  { label: 'Open a page', value: 'link' },
];

/**
 * The "Continue shopping" button's settings (utils/continue-shopping.shared.js),
 * used by the Cart Editor's Checkout Button section and COD → Customize →
 * Cart drawer. `placementOptions` names the two spots for that page.
 */
export function ContinueShoppingFields({ value, onChange, placementOptions, intro, note }) {
  const cs = sanitizeContinueShopping(value);
  const set = (key) => (v) => onChange({ ...cs, [key]: v });
  const urlError = cs.action === 'link' && value?.url && !isValidContinueUrl(value.url)
    ? 'Use a link starting with https:// or a page on your store, like /collections/new.'
    : undefined;

  return (
    <Card>
      <FormLayout>
        <Text as="h3" variant="headingMd">Continue shopping</Text>
        <Checkbox
          label='Show a "Continue shopping" button'
          helpText={intro}
          checked={cs.enabled}
          onChange={set('enabled')}
        />
        {cs.enabled && (
          <BlockStack gap="300">
            <TextField label="Button text" value={value?.text ?? cs.text} onChange={set('text')} maxLength={40} autoComplete="off" />
            <Select label="Placement" options={placementOptions} value={cs.placement} onChange={set('placement')} />
            <Select label="When tapped" options={ACTION_OPTIONS} value={cs.action} onChange={set('action')} />
            {cs.action === 'link' && (
              <TextField
                label="Page link"
                value={value?.url ?? ''}
                onChange={(v) => onChange({ ...cs, url: v })}
                placeholder="/collections/all"
                helpText="A page on your store (/collections/new) or a link starting with https://. Empty = all products."
                error={urlError}
                autoComplete="off"
              />
            )}
            <Select label="Style" options={STYLE_OPTIONS} value={cs.style} onChange={set('style')} />
            <InlineStack gap="400">
              <ColorField label={cs.style === 'filled' ? 'Button colour' : 'Text and border colour'} value={cs.bg} onChange={set('bg')} />
              {cs.style === 'filled' && <ColorField label="Text colour" value={cs.color} onChange={set('color')} />}
            </InlineStack>
            <SliderField label="Text size" value={cs.fontSize} min={CONTINUE_LIMITS.fontSize[0]} max={CONTINUE_LIMITS.fontSize[1]} suffix="px" onChange={set('fontSize')} />
            <SliderField label="Padding top and bottom" value={cs.paddingY} min={CONTINUE_LIMITS.paddingY[0]} max={CONTINUE_LIMITS.paddingY[1]} suffix="px" onChange={set('paddingY')} />
            {cs.style !== 'link' && (
              <SliderField label="Corner radius" value={cs.radius} min={CONTINUE_LIMITS.radius[0]} max={CONTINUE_LIMITS.radius[1]} suffix="px" onChange={set('radius')} />
            )}
            {note && <Text as="p" variant="bodySm" tone="subdued">{note}</Text>}
          </BlockStack>
        )}
      </FormLayout>
    </Card>
  );
}
