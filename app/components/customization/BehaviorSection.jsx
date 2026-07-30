import { memo } from 'react';
import { FormLayout, Select, Checkbox, TextField, Text } from '@shopify/polaris';
import { SectionCard } from './SectionCard';

function BehaviorSectionComponent({
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
      <SectionCard title="Preview Bar" expanded={expandedSections?.previewBar} onToggle={() => toggleSection?.('previewBar')}>
        <FormLayout>
          <Checkbox label="Show Preview Bar" checked={config.show_preview_bar !== false} onChange={(v) => updateConfig('show_preview_bar', v)} />
          {config.show_preview_bar && (
            <>
              <Checkbox label="Show sticky preview bar" checked={!!config.show_sticky_preview_bar} onChange={(v) => updateConfig('show_sticky_preview_bar', v)} />
              {PxField && <PxField label="Preview Bar Width (%)" value={config.preview_bar_width} onChange={(v) => updateConfig('preview_bar_width', v)} min={10} max={100} suffix="%" />}
              <div className="cst-grid-2">
                {ColorPickerField && <ColorPickerField label="Background" value={config.preview_bar_bg || '#fff'} onChange={(v) => updateConfig('preview_bar_bg', v)} />}
                {ColorPickerField && <ColorPickerField label="Text Color" value={config.preview_bar_text_color || '#222'} onChange={(v) => updateConfig('preview_bar_text_color', v)} />}
              </div>
              <div className="cst-grid-2">
                {PxField && <PxField label="Height" value={config.preview_bar_height || 70} onChange={(v) => updateConfig('preview_bar_height', v)} />}
                {PxField && <PxField label="Padding" value={config.preview_bar_padding || 16} onChange={(v) => updateConfig('preview_bar_padding', v)} />}
              </div>

              <div className="cst-section-divider">
                <Text variant="headingSm" as="h6">Combo Summary — Slot Style</Text>
                <Select
                  label="Slot Shape"
                  options={[{ label: 'Circle', value: 'circle' }, { label: 'Square', value: 'square' }]}
                  value={config.preview_item_shape || 'circle'}
                  onChange={(v) => updateConfig('preview_item_shape', v)}
                />
                <div className="cst-grid-2">
                  {PxField && <PxField label="Slot Size" value={config.preview_item_size || (config.layout === 'layout1' || config.layout === 'layout2' || config.layout === 'layout4' ? 48 : 40)} onChange={(v) => updateConfig('preview_item_size', v)} />}
                  {PxField && <PxField label="Slot Gap" value={config.preview_item_gap ?? 12} onChange={(v) => updateConfig('preview_item_gap', v)} />}
                </div>
                <div className="cst-grid-2">
                  {ColorPickerField && <ColorPickerField label="Slot Background" value={config.preview_item_color || '#fff'} onChange={(v) => updateConfig('preview_item_color', v)} />}
                  {ColorPickerField && <ColorPickerField label="Slot Border" value={config.preview_item_border_color || '#eee'} onChange={(v) => updateConfig('preview_item_border_color', v)} />}
                </div>
              </div>

              <div className="cst-section-divider">
                <Text variant="headingSm" as="h6">Combo Summary — Reset Button</Text>
                <Checkbox label="Show Reset Combo button" checked={config.show_reset_btn !== false} onChange={(v) => updateConfig('show_reset_btn', v)} />
                {config.show_reset_btn !== false && (
                  <>
                    <TextField label="Text" value={config.preview_reset_btn_text || 'Reset Combo'} onChange={(v) => updateConfig('preview_reset_btn_text', v)} autoComplete="off" />
                    <div className="cst-grid-2">
                      {ColorPickerField && <ColorPickerField label="Background" value={config.preview_reset_btn_bg || '#ff4d4d'} onChange={(v) => updateConfig('preview_reset_btn_bg', v)} />}
                      {ColorPickerField && <ColorPickerField label="Text Color" value={config.preview_reset_btn_text_color || '#fff'} onChange={(v) => updateConfig('preview_reset_btn_text_color', v)} />}
                    </div>
                  </>
                )}
                {PxField && <PxField label="Button Border Radius" value={config.preview_border_radius ?? 6} onChange={(v) => updateConfig('preview_border_radius', v)} />}
              </div>
              {layout === 'layout4' && (
                <>
                  <TextField label="Checkout Button Text" value={config.preview_checkout_btn_text || 'Proceed to Checkout'} onChange={(v) => updateConfig('preview_checkout_btn_text', v)} autoComplete="off" />
                  <div className="cst-grid-2">
                    {ColorPickerField && <ColorPickerField label="Button BG" value={config.preview_checkout_btn_bg || '#000'} onChange={(v) => updateConfig('preview_checkout_btn_bg', v)} />}
                    {ColorPickerField && <ColorPickerField label="Button Text" value={config.preview_checkout_btn_text_color || '#fff'} onChange={(v) => updateConfig('preview_checkout_btn_text_color', v)} />}
                  </div>
                </>
              )}
            </>
          )}
        </FormLayout>
      </SectionCard>

      <SectionCard title="Variant Selector" expanded={expandedSections.variants} onToggle={() => toggleSection('variants')}>
        <FormLayout>
          <Checkbox label="Show quantity selector" checked={!!config.show_quantity_selector} onChange={(v) => updateConfig('show_quantity_selector', v)} />
          <Select
            label="Preview Icon Visibility"
            options={[
              { label: 'Static (always visible)', value: 'static' },
              { label: 'On Hover', value: 'hover' },
            ]}
            value={config.preview_icon_visibility || 'static'}
            onChange={(v) => updateConfig('preview_icon_visibility', v)}
          />
          <div className="cst-grid-2">
            {ColorPickerField && <ColorPickerField label="Variant Select BG" value={config.variant_select_bg || '#f9f9f9'} onChange={(v) => updateConfig('variant_select_bg', v)} />}
            {ColorPickerField && <ColorPickerField label="Border Color" value={config.variant_select_border_color || '#e0e0e0'} onChange={(v) => updateConfig('variant_select_border_color', v)} />}
          </div>
          <div className="cst-grid-2">
            {ColorPickerField && <ColorPickerField label="Text Color" value={config.variant_select_text_color || '#333'} onChange={(v) => updateConfig('variant_select_text_color', v)} />}
            {PxField && <PxField label="Border Radius" value={config.variant_select_border_radius || 8} onChange={(v) => updateConfig('variant_select_border_radius', v)} />}
          </div>
        </FormLayout>
      </SectionCard>

      <SectionCard title="Buttons" expanded={expandedSections.buttons} onToggle={() => toggleSection?.('buttons')}>
        <FormLayout>
          <Text variant="headingSm" as="h6">Add to Cart Button</Text>
          <TextField label="Text" value={config.add_btn_text || 'Add'} onChange={(v) => updateConfig('add_btn_text', v)} autoComplete="off" />
          <div className="cst-grid-2">
            {ColorPickerField && <ColorPickerField label="Background" value={config.add_btn_bg || '#000'} onChange={(v) => updateConfig('add_btn_bg', v)} />}
            {ColorPickerField && <ColorPickerField label="Text Color" value={config.add_btn_text_color || '#fff'} onChange={(v) => updateConfig('add_btn_text_color', v)} />}
          </div>
          <div className="cst-grid-2">
            {PxField && <PxField label="Font Size" value={config.add_btn_font_size || 14} onChange={(v) => updateConfig('add_btn_font_size', v)} />}
            {PxField && <PxField label="Border Radius" value={config.add_btn_border_radius || 8} onChange={(v) => updateConfig('add_btn_border_radius', v)} />}
          </div>
          <Select label="Font Weight" options={[{ label: 'Normal', value: '400' }, { label: 'Medium', value: '500' }, { label: 'Semi-Bold', value: '600' }, { label: 'Bold', value: '700' }]} value={String(config.add_btn_font_weight || '600')} onChange={(v) => updateConfig('add_btn_font_weight', v)} />

          <div className="cst-section-divider">
            <Text variant="headingSm" as="h6">Checkout Button</Text>
          </div>
          <TextField label="Text" value={config.checkout_btn_text || 'Proceed to Checkout'} onChange={(v) => updateConfig('checkout_btn_text', v)} autoComplete="off" />
          <div className="cst-grid-2">
            {ColorPickerField && <ColorPickerField label="Background" value={config.checkout_btn_bg || '#000'} onChange={(v) => updateConfig('checkout_btn_bg', v)} />}
            {ColorPickerField && <ColorPickerField label="Text Color" value={config.checkout_btn_text_color || '#fff'} onChange={(v) => updateConfig('checkout_btn_text_color', v)} />}
          </div>
        </FormLayout>
      </SectionCard>
    </>
  );
}

export const BehaviorSection = memo(BehaviorSectionComponent);
