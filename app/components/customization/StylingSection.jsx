import { memo } from 'react';
import { FormLayout, Select, Checkbox, Text } from '@shopify/polaris';
import { SectionCard } from './SectionCard';

function StylingSectionComponent({
  config,
  expandedSections,
  toggleSection,
  updateConfig,
  PxField,
  ColorPickerField,
}) {
  const layout = config.layout;

  return (
    <>
      {layout === 'layout2' && (
        <SectionCard
          title="Collection Tabs Premium Styles"
          expanded={expandedSections.collectionTabsStyles}
          onToggle={() => toggleSection('collectionTabsStyles')}
        >
          <FormLayout>
            <Text variant="headingSm" as="h6">Tab Navigation</Text>
            <Select
              label="Navigation Mode"
              options={[
                { label: 'Scroll', value: 'scroll' },
                { label: 'Next / Prev Arrows', value: 'arrows' },
                { label: 'Slide Touch', value: 'slide_touch' },
              ]}
              value={config.tab_navigation_mode || 'scroll'}
              onChange={(v) => updateConfig('tab_navigation_mode', v)}
            />
            <Select
              label="Alignment"
              options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }]}
              value={config.tab_alignment || 'left'}
              onChange={(v) => updateConfig('tab_alignment', v)}
            />
            <div className="cst-grid-2">
              {PxField && <PxField label="Text Size" value={config.tab_font_size} onChange={(v) => updateConfig('tab_font_size', v)} min={10} max={40} />}
              {PxField && <PxField label="Border Radius" value={config.tab_border_radius} onChange={(v) => updateConfig('tab_border_radius', v)} min={0} max={50} />}
            </div>
            <div className="cst-grid-2">
              {PxField && <PxField label="Horizontal Padding" value={config.tab_padding_horizontal} onChange={(v) => updateConfig('tab_padding_horizontal', v)} min={5} max={100} />}
              {PxField && <PxField label="Vertical Padding" value={config.tab_padding_vertical} onChange={(v) => updateConfig('tab_padding_vertical', v)} min={5} max={100} />}
            </div>
            <div className="cst-grid-2">
              {PxField && <PxField label="Margin Top" value={config.tab_margin_top} onChange={(v) => updateConfig('tab_margin_top', v)} min={0} max={200} />}
              {PxField && <PxField label="Margin Bottom" value={config.tab_margin_bottom} onChange={(v) => updateConfig('tab_margin_bottom', v)} min={0} max={300} />}
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Inactive Tab Colors</Text>
              <div className="cst-grid-2">
                {ColorPickerField && <ColorPickerField label="Background" value={config.tab_bg_color} onChange={(v) => updateConfig('tab_bg_color', v)} />}
                {ColorPickerField && <ColorPickerField label="Text" value={config.tab_text_color} onChange={(v) => updateConfig('tab_text_color', v)} />}
              </div>
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Active Tab Colors</Text>
              <div className="cst-grid-2">
                {ColorPickerField && <ColorPickerField label="Background" value={config.tab_active_bg_color || config.selection_highlight_color} onChange={(v) => updateConfig('tab_active_bg_color', v)} />}
                {ColorPickerField && <ColorPickerField label="Text" value={config.tab_active_text_color} onChange={(v) => updateConfig('tab_active_text_color', v)} />}
              </div>
            </div>
          </FormLayout>
        </SectionCard>
      )}

      <SectionCard title="Product Card Style" expanded={expandedSections.productCard} onToggle={() => toggleSection('productCard')}>
        <FormLayout>
          <Select
            label="Variants Display"
            options={[
              { label: 'Static', value: 'static' },
              { label: 'On Hover', value: 'hover' },
              { label: 'Popup', value: 'popup' },
            ]}
            value={config.product_card_variants_display || 'static'}
            onChange={(v) => updateConfig('product_card_variants_display', v)}
          />
          <div className="cst-grid-2">
            {PxField && <PxField label="Card Padding (px)" value={config.product_card_padding || 10} onChange={(v) => updateConfig('product_card_padding', v)} />}
            {PxField && <PxField label="Gap (px)" value={config.products_gap || 12} onChange={(v) => updateConfig('products_gap', v)} />}
          </div>
          <Checkbox label="Enable product hover effect" checked={!!config.enable_product_hover} onChange={(v) => updateConfig('enable_product_hover', v)} />
          {config.enable_product_hover && (
            <Select
              label="Hover Mode"
              options={[
                { label: 'Show Second Image', value: 'second_image' },
                { label: 'Show Description', value: 'description' },
              ]}
              value={config.product_hover_mode || 'second_image'}
              onChange={(v) => updateConfig('product_hover_mode', v)}
            />
          )}
        </FormLayout>
      </SectionCard>
    </>
  );
}

export const StylingSection = memo(StylingSectionComponent);
