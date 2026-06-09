import { memo } from 'react';
import { FormLayout, Select, Checkbox, Text, RangeSlider } from '@shopify/polaris';
import { SectionCard } from './SectionCard';

function ProductsSectionComponent({
  config,
  expanded,
  onToggle,
  updateConfig,
  PxField,
  ColorPickerField,
}) {
  return (
    <SectionCard title="Products & Grid" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <Checkbox label="Show product grid" checked={!!config.show_products_grid} onChange={(v) => updateConfig('show_products_grid', v)} />
        <Checkbox label="Show sold out products" checked={!!config.show_sold_out_products} onChange={(v) => updateConfig('show_sold_out_products', v)} />
        {PxField && <PxField label="Grid Width (%)" value={config.grid_width} onChange={(v) => updateConfig('grid_width', v)} min={10} max={100} suffix="%" helpText="Adjust the overall width of the product grid" />}

        {config.show_products_grid && (
          <div className="cst-grid-2">
            <Select label="Desktop Columns" options={[{ label: '2', value: '2' }, { label: '3', value: '3' }, { label: '4', value: '4' }]} value={config.desktop_columns} onChange={(v) => updateConfig('desktop_columns', v)} />
            <Select label="Layout Type" options={[{ label: 'Grid', value: 'grid' }, { label: 'Slider', value: 'slider' }]} value={config.grid_layout_type} onChange={(v) => updateConfig('grid_layout_type', v)} />

            {config.grid_layout_type === 'slider' && (
              <div className="cst-nested-block cst-full-width">
                <div className="cst-nested-title">
                  <Text variant="headingMd" as="h5">Slider Customization</Text>
                </div>
                <div className="cst-group">
                  <Text variant="headingSm" as="h6">Navigation</Text>
                  <Checkbox label="Show Navigation Arrows" checked={!!config.show_nav_arrows} onChange={(v) => updateConfig('show_nav_arrows', v)} />
                  {config.show_nav_arrows && (
                    <div className="cst-nested-block">
                      <div className="cst-grid-2">
                        {ColorPickerField && <ColorPickerField label="Icon Color" value={config.arrow_color || '#ffffff'} onChange={(v) => updateConfig('arrow_color', v)} />}
                        {ColorPickerField && <ColorPickerField label="Background" value={config.arrow_bg_color || '#000000'} onChange={(v) => updateConfig('arrow_bg_color', v)} />}
                        {PxField && <PxField label="Size" value={config.arrow_size || 40} onChange={(v) => updateConfig('arrow_size', v)} />}
                        {PxField && <PxField label="Radius (%)" value={config.arrow_border_radius || 50} onChange={(v) => updateConfig('arrow_border_radius', v)} suffix="%" max={50} />}
                      </div>
                      <RangeSlider label="Opacity" value={config.arrow_opacity ?? 0.9} onChange={(v) => updateConfig('arrow_opacity', v)} min={0} max={1} step={0.1} output />
                      <Select label="Arrow Position" options={[{ label: 'Inside Slider', value: 'inside' }, { label: 'Outside Slider', value: 'outside' }]} value={config.arrow_position || 'inside'} onChange={(v) => updateConfig('arrow_position', v)} />
                    </div>
                  )}
                </div>
                <div className="cst-group">
                  <Text variant="headingSm" as="h6">Interaction</Text>
                  <Checkbox label="Enable Touch/Swipe" checked={config.enable_touch_swipe !== false} onChange={(v) => updateConfig('enable_touch_swipe', v)} />
                  {config.enable_touch_swipe !== false && (
                    <div className="cst-nested-block">
                      <RangeSlider label="Sensitivity" value={config.swipe_sensitivity || 5} onChange={(v) => updateConfig('swipe_sensitivity', v)} min={1} max={10} output />
                    </div>
                  )}
                </div>
                <div className="cst-group">
                  <Text variant="headingSm" as="h6">Appearance</Text>
                  <Checkbox label="Show Scrollbar" checked={!!config.show_scrollbar} onChange={(v) => updateConfig('show_scrollbar', v)} />
                  {config.show_scrollbar && (
                    <div className="cst-grid-2">
                      {ColorPickerField && <ColorPickerField label="Scroll Color" value={config.scrollbar_color || '#dddddd'} onChange={(v) => updateConfig('scrollbar_color', v)} />}
                      {PxField && <PxField label="Thickness" value={config.scrollbar_thickness || 4} onChange={(v) => updateConfig('scrollbar_thickness', v)} />}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Select label="Mobile Columns" options={[{ label: '1', value: '1' }, { label: '2', value: '2' }]} value={config.mobile_columns} onChange={(v) => updateConfig('mobile_columns', v)} />
            <Select label="Image Ratio" options={[{ label: 'Portrait (3:4)', value: 'portrait' }, { label: 'Square (1:1)', value: 'square' }, { label: 'Rectangle (4:3)', value: 'rectangle' }]} value={config.product_image_ratio || 'square'} onChange={(v) => updateConfig('product_image_ratio', v)} />
            {PxField && <PxField label="Image Height (Desktop)" value={config.product_image_height_desktop} onChange={(v) => updateConfig('product_image_height_desktop', v)} />}
            {PxField && <PxField label="Image Height (Mobile)" value={config.product_image_height_mobile} onChange={(v) => updateConfig('product_image_height_mobile', v)} />}
          </div>
        )}
      </FormLayout>
    </SectionCard>
  );
}

export const ProductsSection = memo(ProductsSectionComponent);
