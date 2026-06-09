import { memo } from 'react';
import { FormLayout, TextField, Select, Checkbox, Text, RangeSlider } from '@shopify/polaris';
import { SectionCard } from './SectionCard';

function BannerSectionComponent({ config, expanded, onToggle, updateConfig, PxField }) {
  return (
    <SectionCard title="Banner Settings" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <Checkbox
          label="Show Banner"
          checked={!!config.show_banner}
          onChange={(checked) => updateConfig('show_banner', checked)}
        />
        {config.show_banner && (
          <>
            <TextField label="Desktop Banner Image URL" value={config.banner_image_url} onChange={(v) => updateConfig('banner_image_url', v)} autoComplete="off" placeholder="https://example.com/desktop-banner.jpg" />
            <TextField label="Mobile Banner Image URL" value={config.banner_image_mobile_url} onChange={(v) => updateConfig('banner_image_mobile_url', v)} autoComplete="off" placeholder="https://example.com/mobile-banner.jpg" helpText="Leave empty to use desktop banner on mobile" />
            <Select
              label="Banner Fit Mode"
              options={[
                { label: 'Cover (Fill & Crop)', value: 'cover' },
                { label: 'Contain (Show Full Image)', value: 'contain' },
                { label: 'Adapt to Image (Natural Height)', value: 'adapt' },
              ]}
              value={config.banner_fit_mode || 'cover'}
              onChange={(v) => updateConfig('banner_fit_mode', v)}
            />
            <Checkbox label="Full Width" checked={!!config.banner_full_width} onChange={(v) => updateConfig('banner_full_width', v)} helpText="Edge-to-edge ignoring container padding" />

            {config.layout === 'layout3' && (
              <>
                <div style={{ marginTop: 16 }}>
                  <Checkbox label="Enable Banner Slider (Rotates 3 images)" checked={!!config.enable_banner_slider} onChange={(v) => updateConfig('enable_banner_slider', v)} />
                  {config.enable_banner_slider && (
                    <div className="cst-nested-block">
                      <RangeSlider label="Auto-Rotation Speed (Seconds)" value={config.slider_speed || 5} onChange={(v) => updateConfig('slider_speed', v)} min={2} max={15} output />
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="cst-slider-item">
                          <Text variant="headingSm" as="h6">Banner {i}</Text>
                          <TextField label="Image URL" value={config[`banner_${i}_image`]} onChange={(v) => updateConfig(`banner_${i}_image`, v)} autoComplete="off" />
                          <TextField label="Title" value={config[`banner_${i}_title`]} onChange={(v) => updateConfig(`banner_${i}_title`, v)} autoComplete="off" />
                          <TextField label="Subtitle" value={config[`banner_${i}_subtitle`]} onChange={(v) => updateConfig(`banner_${i}_subtitle`, v)} autoComplete="off" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Desktop Sizing</Text>
              <div className="cst-grid-2">
                {PxField && <PxField label="Width (%)" value={config.banner_width_desktop} onChange={(v) => updateConfig('banner_width_desktop', v)} min={0} max={100} suffix="%" />}
                {PxField && <PxField label="Height (px)" value={config.banner_height_desktop} onChange={(v) => updateConfig('banner_height_desktop', v)} />}
              </div>
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Mobile Sizing</Text>
              <div className="cst-grid-2">
                {PxField && <PxField label="Width (%)" value={config.banner_width_mobile || config.banner_width_desktop} onChange={(v) => updateConfig('banner_width_mobile', v)} min={0} max={100} suffix="%" />}
                {PxField && <PxField label="Height (px)" value={config.banner_height_mobile || config.banner_height_desktop} onChange={(v) => updateConfig('banner_height_mobile', v)} />}
              </div>
            </div>
          </>
        )}
      </FormLayout>
    </SectionCard>
  );
}

export const BannerSection = memo(BannerSectionComponent);
