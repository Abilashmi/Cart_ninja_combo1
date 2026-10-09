import { memo } from 'react';
import { FormLayout, Checkbox, Text, TextField } from '@shopify/polaris';
import { SectionCard } from './SectionCard';
import { OfferSection } from './OfferSection';
import { QUICK_SHOP_LAYOUT, isWeightCombo } from '../../utils/combo-weight.shared.js';

function AdvancedSectionComponent({
  config,
  expandedSections,
  toggleSection,
  updateConfig,
  ColorPickerField,
  localActiveDiscounts = [],
  onCreateCoupon,
  weightStatus,
  savedWeightHash,
}) {
  const isWeight = isWeightCombo(config);
  // Quick Shop has its own Top progress / Bottom bar (Style tab) and no AI row.
  const isQuickShop = config.layout === QUICK_SHOP_LAYOUT;

  return (
    <>
      {!isQuickShop && <SectionCard title="Progress Bar" expanded={expandedSections?.progressBar} onToggle={() => toggleSection?.('progressBar')}>
        <FormLayout>
          {isWeight && (
            <Text as="p" variant="bodySm" tone="subdued">
              Weight-priced combos always show the weight meter instead, with the tiers and messages from Offer. Its colours and heading come from here.
            </Text>
          )}
          {isWeight && ColorPickerField && <ColorPickerField label="Meter Color" value={config.progress_bar_color || '#111827'} onChange={(v) => updateConfig('progress_bar_color', v)} />}
          {isWeight && <TextField label="Meter Heading" value={config.progress_text || ''} placeholder="Your box" onChange={(v) => updateConfig('progress_text', v)} autoComplete="off" />}
          {!isWeight && <Checkbox label="Show Progress Bar" checked={!!config.show_progress_bar} onChange={(v) => updateConfig('show_progress_bar', v)} />}
          {!isWeight && config.show_progress_bar && (
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
      </SectionCard>}

      {/* Section key stays "discount": the setup tour and "find a setting" open it by that name. */}
      <div data-tour="combo-discount">
        <OfferSection
          config={config}
          updateConfig={updateConfig}
          expanded={expandedSections?.discount}
          onToggle={() => toggleSection?.('discount')}
          localActiveDiscounts={localActiveDiscounts}
          onCreateCoupon={onCreateCoupon}
          weightStatus={weightStatus}
          savedWeightHash={savedWeightHash}
        />
      </div>

      {!isQuickShop && <SectionCard title="AI Settings" expanded={expandedSections?.aiSettings} onToggle={() => toggleSection?.('aiSettings')}>
        <FormLayout>
          <Checkbox
            label="Enable AI Suggestions for Customers"
            checked={!!config.ai_mode}
            onChange={(v) => updateConfig('ai_mode', v)}
            helpText="As shoppers pick items, the live combo page shows a row of other products from this combo that AI picked as the best matches for their choices. Try it here by adding products in the preview; the live page uses it after you save."
          />
          {config.ai_mode && (
            <TextField
              label="Suggestions heading"
              value={config.ai_suggestions_title ?? ''}
              placeholder="Pairs well with your picks"
              onChange={(v) => updateConfig('ai_suggestions_title', v)}
              autoComplete="off"
            />
          )}
        </FormLayout>
      </SectionCard>}

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
