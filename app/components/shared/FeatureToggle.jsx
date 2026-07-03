import React from 'react';
import { InlineStack, Text } from '@shopify/polaris';

export function FeatureToggle({ label, enabled, onToggle, disabled = false, badge = null }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <InlineStack gap="200" blockAlign="center">
        {label && <Text as="span" variant="bodyMd" fontWeight="semibold">{label}</Text>}
        {badge}
      </InlineStack>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label || (enabled ? 'Turn off' : 'Turn on')}
        onClick={() => { if (disabled) return; onToggle(!enabled); }}
        disabled={disabled}
        title={disabled ? 'Upgrade your plan to enable this' : undefined}
        style={{
          width: '44px',
          height: '24px',
          padding: '2px',
          borderRadius: '999px',
          border: `1px solid ${enabled ? '#008060' : '#c9cccf'}`,
          background: enabled ? '#008060' : '#dfe3e8',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
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
