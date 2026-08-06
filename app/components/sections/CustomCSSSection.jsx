import React from 'react';
import { Card, BlockStack, Text, Badge, InlineStack, Icon } from '@shopify/polaris';
import { CheckCircleIcon, XCircleIcon } from '@shopify/polaris-icons';
import { useCartEditor } from '../../context/CartEditorContext';
import { CustomizableLockedSection } from '../plan/PlanGate';
import { usePlan } from '../PlanContext';
import { PLANS } from '../../config/plans';

// Fully automatic and plan-based — Free always shows the watermark, Starter/
// Pro never does (see save_cart_drawer.php's resolveShowWatermark). There's
// nothing for the merchant to toggle, so this is a status display, not a
// control.
function WatermarkToggle() {
  const { plan } = usePlan();
  const removable = PLANS[plan]?.watermarkRemovable;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">Branding</Text>
          {!removable && <Badge tone="info">Requires Starter</Badge>}
        </InlineStack>
        <InlineStack gap="200" blockAlign="center">
          <Icon source={removable ? CheckCircleIcon : XCircleIcon} tone={removable ? 'success' : 'subdued'} />
          <Text as="p" variant="bodyMd">
            {removable
              ? '"Powered by BRIX" watermark is automatically removed on your current plan.'
              : 'The Free plan always displays the "Powered by BRIX" watermark on your storefront. Upgrade to Starter or Pro to remove it automatically.'}
          </Text>
        </InlineStack>
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
