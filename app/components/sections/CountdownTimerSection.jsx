import React from 'react';
import { Card, FormLayout, TextField, BlockStack, Text, InlineStack, Select } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { ColorField } from './ColorField';
import { FeatureToggle } from '../shared/FeatureToggle';

export function CountdownTimerSection() {
  const { body, updateCountdownTimer } = useCartEditor();
  const { countdownTimer } = body;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Show an urgency countdown inside the Cart Drawer to encourage checkout.
      </Text>
      <Card>
        <FormLayout>
          <FeatureToggle
            label="Enable Countdown Timer"
            enabled={countdownTimer.enabled}
            onToggle={(v) => updateCountdownTimer({ enabled: v })}
          />
          <Select
            label="Timer Mode"
            options={[
              { label: 'Per-session (resets each visit)', value: 'session' },
              { label: 'Fixed countdown', value: 'fixed' },
            ]}
            value={countdownTimer.mode}
            onChange={(v) => updateCountdownTimer({ mode: v })}
          />
          <InlineStack gap="400">
            <TextField
              label="Hours"
              type="number"
              value={String(countdownTimer.hours)}
              onChange={(v) => updateCountdownTimer({ hours: Number(v) || 0 })}
              autoComplete="off"
            />
            <TextField
              label="Minutes"
              type="number"
              value={String(countdownTimer.minutes)}
              onChange={(v) => updateCountdownTimer({ minutes: Number(v) || 0 })}
              autoComplete="off"
            />
          </InlineStack>
          <TextField
            label="Label"
            value={countdownTimer.label}
            onChange={(v) => updateCountdownTimer({ label: v })}
            autoComplete="off"
          />
          <TextField
            label="Expired Label"
            value={countdownTimer.expiredLabel}
            onChange={(v) => updateCountdownTimer({ expiredLabel: v })}
            autoComplete="off"
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Colors</Text>
          <InlineStack gap="400">
            <ColorField
              label="Background"
              value={countdownTimer.bgColor}
              onChange={(v) => updateCountdownTimer({ bgColor: v })}
            />
            <ColorField
              label="Text"
              value={countdownTimer.textColor}
              onChange={(v) => updateCountdownTimer({ textColor: v })}
            />
            <ColorField
              label="Accent"
              value={countdownTimer.accentColor}
              onChange={(v) => updateCountdownTimer({ accentColor: v })}
            />
          </InlineStack>
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Visibility</Text>
          <FeatureToggle
            label="Show on Product pages"
            enabled={countdownTimer.showOnProducts}
            onToggle={(v) => updateCountdownTimer({ showOnProducts: v })}
          />
          <FeatureToggle
            label="Show alongside Coupons"
            enabled={countdownTimer.showOnCoupons}
            onToggle={(v) => updateCountdownTimer({ showOnCoupons: v })}
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <Text as="h3" variant="headingMd">Linked Coupon (optional)</Text>
          <Select
            label="Coupon Mode"
            options={[
              { label: 'Manual code', value: 'manual' },
              { label: 'No coupon', value: 'none' },
            ]}
            value={countdownTimer.couponMode}
            onChange={(v) => updateCountdownTimer({ couponMode: v })}
          />
          {countdownTimer.couponMode === 'manual' && (
            <TextField
              label="Coupon Code"
              value={countdownTimer.couponCode || ''}
              onChange={(v) => updateCountdownTimer({ couponCode: v })}
              autoComplete="off"
            />
          )}
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
