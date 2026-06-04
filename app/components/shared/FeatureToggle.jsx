import React from 'react';
import { InlineStack, Text } from '@shopify/polaris';

export function FeatureToggle({ label, enabled, onToggle }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      {label && <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label || (enabled ? 'Turn off' : 'Turn on')}
        onClick={() => onToggle(!enabled)}
        style={{
          width: '44px',
          height: '24px',
          padding: '2px',
          borderRadius: '999px',
          border: `1px solid ${enabled ? '#008060' : '#c9cccf'}`,
          background: enabled ? '#008060' : '#dfe3e8',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.18s ease, border-color 0.18s ease',
          flexShrink: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'block',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            transform: enabled ? 'translateX(20px)' : 'translateX(0)',
            transition: 'transform 0.18s ease',
          }}
        />
      </button>
    </InlineStack>
  );
}
