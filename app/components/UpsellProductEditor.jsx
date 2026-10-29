import React from 'react';
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Checkbox,
  TextField,
  Select,
  Divider,
  Badge,
  Box,
  Icon,
  Layout,
  ResourceList,
  ResourceItem,
  Thumbnail,
} from '@shopify/polaris';
import {
  SettingsIcon,
  ProductIcon,
  DeleteIcon,
  PlusIcon,
  MagicIcon,
} from '@shopify/polaris-icons';
import { UPSELL_STYLES } from '../services/api.cart-settings.shared';

export default function UpsellProductEditor({
  upsellConfig,
  setUpsellConfig,
  manualUpsellRules,
  removeManualUpsellRule,
  getTriggerSummary,
  getUpsellSummary,
  getUpsellValidationError,
  handleSaveUpsellRules,
  handleCancelUpsellRules,
  upsellSaving,
  setShowManualUpsellBuilder,
  setInitialManualUpsellRules,
}) {
  const updateUpsellConfig = (key, value) => {
    setUpsellConfig({ ...upsellConfig, [key]: value });
  };

  const updateTitleConfig = (key, value) => {
    setUpsellConfig({
      ...upsellConfig,
      upsellTitle: { ...upsellConfig.upsellTitle, [key]: value },
    });
  };

  return (
    <div style={{ padding: '0 20px 20px 20px' }}>
      <BlockStack gap="400">
        {/* Header with Save Button */}
        <Box paddingBlockStart="400" paddingBlockEnd="400">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text variant="headingLg" as="h1">Upsell Products</Text>
              <Text variant="bodySm" tone="subdued">Recommend products that go with what is in the cart.</Text>
            </BlockStack>
            <Button variant="primary" onClick={handleSaveUpsellRules} loading={upsellSaving}>Save Upsell Config</Button>
          </InlineStack>
        </Box>

        {/* Feature Enable Card */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text variant="headingMd" as="h2">Enable Feature</Text>
                <Text variant="bodySm" tone="subdued">Show upsell products in the cart drawer.</Text>
              </BlockStack>
              <Checkbox
                label="Enabled"
                labelHidden
                checked={upsellConfig.enabled}
                onChange={(val) => updateUpsellConfig('enabled', val)}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {upsellConfig.enabled && (
          <>
            {/* Display Settings Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={SettingsIcon} tone="base" />
                  <Text variant="headingMd" as="h2">Display Settings</Text>
                </InlineStack>

                <TextField
                  label="Upsell Section Title"
                  value={upsellConfig.upsellTitle.text}
                  onChange={(val) => updateTitleConfig('text', val)}
                  placeholder="e.g., Frequently Bought Together"
                  autoComplete="off"
                />

                <InlineStack gap="600" align="start">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="Template Style"
                      options={Object.entries(UPSELL_STYLES).map(([key, value]) => ({
                        label: value.charAt(0).toUpperCase() + value.slice(1),
                        value: value,
                      }))}
                      value={upsellConfig.activeTemplate}
                      onChange={(val) => updateUpsellConfig('activeTemplate', val)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Checkbox
                      label="Show on empty cart"
                      checked={upsellConfig.showOnEmptyCart}
                      onChange={(val) => updateUpsellConfig('showOnEmptyCart', val)}
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Manual Rules Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={MagicIcon} tone="base" />
                    <Text variant="headingMd" as="h2">Recommendation Rules</Text>
                  </InlineStack>
                  <Button
                    icon={PlusIcon}
                    onClick={() => {
                      setInitialManualUpsellRules([...manualUpsellRules]);
                      setShowManualUpsellBuilder(true);
                    }}
                  >
                    Add Rule
                  </Button>
                </InlineStack>

                <Text tone="subdued" variant="bodySm">
                  Define which products to recommend based on what's currently in the cart.
                </Text>

                <Divider />

                {manualUpsellRules.length > 0 ? (
                  <ResourceList
                    resourceName={{ singular: 'rule', plural: 'rules' }}
                    items={manualUpsellRules}
                    renderItem={(rule) => {
                      const { id } = rule;
                      const triggerSummary = getTriggerSummary(rule);
                      const upsellSummary = getUpsellSummary(rule);
                      const error = getUpsellValidationError(rule);

                      return (
                        <ResourceItem id={id} accessibilityLabel={`Edit rule ${id}`}>
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="100" style={{ flex: 1 }}>
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="bold">If cart contains:</Text>
                                <Text variant="bodyMd">{triggerSummary}</Text>
                              </InlineStack>
                              <InlineStack gap="200" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="bold">Then recommend:</Text>
                                <Text variant="bodyMd">{upsellSummary}</Text>
                              </InlineStack>
                              {error && (
                                <Text tone="critical" variant="bodyXs">{error}</Text>
                              )}
                            </BlockStack>
                            <Button
                              icon={DeleteIcon}
                              tone="critical"
                              variant="plain"
                              onClick={() => removeManualUpsellRule(id)}
                            />
                          </InlineStack>
                        </ResourceItem>
                      );
                    }}
                  />
                ) : (
                  <Box padding="600">
                    <BlockStack gap="200" align="center">
                      <Text tone="subdued">No rules defined yet.</Text>
                      <Button
                        variant="plain"
                        onClick={() => {
                          setInitialManualUpsellRules([...manualUpsellRules]);
                          setShowManualUpsellBuilder(true);
                        }}
                      >
                        Create your first rule
                      </Button>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </>
        )}
      </BlockStack>
    </div>
  );
}
