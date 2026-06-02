import React from 'react';
import { Card, BlockStack, Text } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';

export function CustomCSSSection() {
  const { footer, updateCustomCSS } = useCartEditor();

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Add custom CSS to override default cart drawer styles.
      </Text>
      <Card>
        <BlockStack gap="300">
          <textarea
            value={footer.customCSS}
            onChange={(e) => updateCustomCSS(e.target.value)}
            placeholder={`.cart-drawer {\n  /* Your custom styles */\n}`}
            style={{
              width: '100%',
              minHeight: '240px',
              padding: '12px',
              fontFamily: 'monospace',
              fontSize: '13px',
              border: '1px solid #c9cccf',
              borderRadius: '8px',
              resize: 'vertical',
              lineHeight: 1.6,
              background: '#1e1e1e',
              color: '#d4d4d4',
              boxSizing: 'border-box',
            }}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Use CSS selectors to target specific elements. Example: .cart-drawer-item, .cart-total
          </Text>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
