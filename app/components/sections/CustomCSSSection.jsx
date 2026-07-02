import React from 'react';
import { Card, BlockStack, Text, Checkbox, Badge, InlineStack } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { CustomizableLockedSection } from '../plan/PlanGate';
import { usePlan } from '../PlanContext';
import { PLANS } from '../../config/plans';

function WatermarkToggle() {
  const { footer, updateWatermark } = useCartEditor();
  const { plan } = usePlan();
  const removable = PLANS[plan]?.watermarkRemovable;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">Branding</Text>
          {!removable && <Badge tone="info">Requires Starter</Badge>}
        </InlineStack>
        <Checkbox
          label='Show "Powered by BRIX" watermark'
          checked={removable ? footer.watermarkEnabled !== false : true}
          disabled={!removable}
          onChange={(checked) => updateWatermark(checked)}
          helpText={removable
            ? 'You can remove this on your current plan.'
            : 'The Free plan always displays this watermark on your storefront.'}
        />
      </BlockStack>
    </Card>
  );
}

export function CustomCSSSection() {
  const { footer, updateCustomCSS } = useCartEditor();

  return (
    <BlockStack gap="400">
      <WatermarkToggle />
    <CustomizableLockedSection featureKey="custom_css">
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
    </CustomizableLockedSection>
    </BlockStack>
  );
}
