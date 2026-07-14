import React from 'react';
import { TextField, InlineStack, Text } from '@shopify/polaris';

export function SliderField({ label, value, onChange, min = 0, max = 100, step = 1, suffix = '', helpText }) {
  const clamp = (n) => Math.min(max, Math.max(min, n));

  const handleInputChange = (v) => {
    if (v === '') return;
    const num = Number(v);
    if (Number.isNaN(num)) return;
    onChange(clamp(num));
  };

  return (
    <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="span" variant="bodyMd">{label}</Text>
      </div>
      <div style={{ width: '90px', flexShrink: 0 }}>
        <TextField
          label={label}
          labelHidden
          type="number"
          value={String(value)}
          suffix={suffix || undefined}
          min={min}
          max={max}
          step={step}
          autoComplete="off"
          onChange={handleInputChange}
          helpText={helpText}
        />
      </div>
    </InlineStack>
  );
}
