import React from 'react';
import { InlineStack, Text } from '@shopify/polaris';

export function FeatureToggle({ label, enabled, onToggle }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>
      <button
        onClick={() => onToggle(!enabled)}
        style={{
          padding: '4px 12px',
          borderRadius: '12px',
          border: 'none',
          background: enabled ? '#008060' : '#8c9196',
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          minWidth: '44px',
        }}
      >
        {enabled ? 'ON' : 'OFF'}
      </button>
    </InlineStack>
  );
}
