import { memo } from 'react';
import { FormLayout, Checkbox, Select, Text, Button, TextField } from '@shopify/polaris';
import { SectionCard } from './SectionCard';

function AdvancedSectionComponent({
  config,
  expandedSections,
  toggleSection,
  updateConfig,
  ColorPickerField,
  localActiveDiscounts = [],
  onCreateCoupon,
}) {
  const couponOptions = (localActiveDiscounts || []).map((d) => ({
    label: `${d.title || d.code || 'Untitled'} (${d.code || ''})`,
    value: String(d.id),
  }));

  return (
    <>
      <SectionCard title="Progress Bar" expanded={expandedSections?.progressBar} onToggle={() => toggleSection?.('progressBar')}>
        <FormLayout>
          <Checkbox label="Show Progress Bar" checked={!!config.show_progress_bar} onChange={(v) => updateConfig('show_progress_bar', v)} />
          {config.show_progress_bar && (
            <>
              {ColorPickerField && <ColorPickerField label="Progress Bar Color" value={config.progress_bar_color || '#000000'} onChange={(v) => updateConfig('progress_bar_color', v)} />}
              <TextField label="Progress Text" value={config.progress_text || ''} onChange={(v) => updateConfig('progress_text', v)} autoComplete="off" helpText="Shown near the progress bar" />
              <div className="cst-section-divider">
                <Text variant="headingSm" as="h6">Discount Offer</Text>
              </div>
              <TextField label="Discount Threshold" type="number" value={String(config.discount_threshold || 5)} onChange={(v) => updateConfig('discount_threshold', Math.max(1, Number(v)))} autoComplete="off" helpText="Items needed to unlock discount" />
              <TextField label="Limit Reached Message" value={config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.'} onChange={(v) => updateConfig('limit_reached_message', v)} autoComplete="off" multiline={2} helpText="Use {{limit}} as a placeholder for the max selections number." />
              <TextField label="Discount Motivation Text" value={config.discount_motivation_text || 'Add {{remaining}} more items to unlock the discount!'} onChange={(v) => updateConfig('discount_motivation_text', v)} autoComplete="off" multiline={2} helpText="Use {{remaining}} as a placeholder for the items left to unlock discount." />
              <TextField label="Discount Unlocked Text" value={config.discount_unlocked_text || 'Discount Unlocked!'} onChange={(v) => updateConfig('discount_unlocked_text', v)} autoComplete="off" />
            </>
          )}
        </FormLayout>
      </SectionCard>

      <SectionCard title="Coupon" expanded={expandedSections?.discount} onToggle={() => toggleSection?.('discount')}>
        <FormLayout>
          <Checkbox
            label="Offer a coupon?"
            checked={!!config.has_discount_offer}
            onChange={(v) => {
              updateConfig('has_discount_offer', v);
              if (!v) updateConfig('selected_discount_id', null);
            }}
            helpText="Enable to offer a coupon code with this bundle"
          />
          {!config.has_discount_offer && (
            <Button variant="secondary" onClick={() => onCreateCoupon?.()} fullWidth>
              Create Coupon
            </Button>
          )}
          {!!config.has_discount_offer && (
            couponOptions.length > 0 ? (
              <Select
                label="Select Coupon"
                value={String(config.selected_discount_id || '')}
                placeholder="Choose a coupon..."
                options={couponOptions}
                onChange={(v) => updateConfig('selected_discount_id', v || null)}
              />
            ) : (
              <>
                <Text as="p" variant="bodySm" tone="subdued">No coupons created yet.</Text>
                <Button variant="secondary" onClick={() => onCreateCoupon?.()} fullWidth>
                  Create Coupon
                </Button>
              </>
            )
          )}
        </FormLayout>
      </SectionCard>

      <SectionCard title="AI Settings" expanded={expandedSections?.aiSettings} onToggle={() => toggleSection?.('aiSettings')}>
        <FormLayout>
          <Checkbox
            label="Enable AI Suggestions for Customers"
            checked={!!config.ai_mode}
            onChange={(v) => updateConfig('ai_mode', v)}
            helpText="When enabled, AI will suggest products and collections to customers on the storefront"
          />
        </FormLayout>
      </SectionCard>

      <SectionCard title="Custom CSS" expanded={expandedSections?.customCss} onToggle={() => toggleSection?.('customCss')}>
        <FormLayout>
          <TextField
            label="Custom CSS"
            value={config.custom_css || ''}
            onChange={(v) => updateConfig('custom_css', v)}
            autoComplete="off"
            multiline={6}
            monospaced
            helpText="Add custom CSS rules to override styles"
          />
        </FormLayout>
      </SectionCard>
    </>
  );
}

export const AdvancedSection = memo(AdvancedSectionComponent);
