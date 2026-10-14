/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Style → Page loader: what shoppers see while a combo page loads (every
// combo template). Settings are flat loader_* keys; the preview below is the
// storefront's own HTML (app/utils/combo-loader.shared.js).
import { memo, useMemo } from 'react';
import { BlockStack, Checkbox, RangeSlider, Select, Text, TextField } from '@shopify/polaris';
import { SectionCard } from './SectionCard';
import { StylePicker } from './QuickShopSections';
import LogoUploader from '../cod/LogoUploader';
import { createComboLoader } from '../../utils/combo-loader.shared.js';

const Loader = createComboLoader();
const D = Loader.DEFAULTS;

const ring = { width: 22, height: 22, borderRadius: '50%', border: '3px solid #e5e7eb', borderTopColor: '#111827' };
const STYLES = [
  { value: 'ring', label: 'Round', preview: <span style={ring} /> },
  { value: 'dots', label: 'Dots', preview: <span style={{ display: 'flex', gap: 3 }}>{[0.45, 1, 0.45].map((o, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#111827', opacity: o }} />)}</span> },
  { value: 'pulse', label: 'Pulse', preview: <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#111827', opacity: 0.7, boxShadow: '0 0 0 4px rgba(17,24,39,.15)' }} /> },
];

const UPLOADER_CSS = `
.cod-logo-box{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;border-radius:12px;box-shadow:inset 0 0 0 1px #e3e3e3}
.cod-logo-img{height:56px;min-width:120px;max-width:220px;padding:8px 12px;border-radius:8px;display:grid;place-items:center;background-color:#fff;background-image:linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%),linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%);background-size:12px 12px;background-position:0 0,6px 6px}
.cod-logo-img img{max-height:40px;max-width:196px;object-fit:contain;display:block}
.cod-logo-drop .Polaris-DropZone{min-height:96px}
.cst-loader-preview{border:1px solid #e1e3e5;border-radius:10px;overflow:hidden}
`;

const val = (config, key) => (config[key] === undefined || config[key] === null ? D[key] : config[key]);

function Slider({ config, updateConfig, keyName, label, min, max, suffix = 'px' }) {
  const value = Number(val(config, keyName));
  return (
    <RangeSlider
      label={label} min={min} max={max} value={value} output
      suffix={<Text as="span" variant="bodySm">{value}{suffix}</Text>}
      onChange={(v) => updateConfig(keyName, Number(v))}
    />
  );
}

function LoaderSectionComponent({ config, updateConfig, expanded, onToggle, ColorPickerField }) {
  const settings = useMemo(() => Loader.pick(config), [config]);
  const on = settings.enabled;
  const preview = useMemo(() => Loader.html({ ...settings, enabled: true }, { inline: true, minHeight: 200 }), [settings]);

  return (
    <SectionCard title="Page loader" expanded={expanded} onToggle={onToggle} badge={on ? STYLES.find((s) => s.value === settings.style)?.label : 'Off'}>
      <style>{UPLOADER_CSS + Loader.CSS}</style>
      <BlockStack gap="400">
        <Checkbox
          label="Show a loader while the page loads"
          checked={on}
          onChange={(v) => updateConfig('loader_enabled', v)}
          helpText="Shoppers see it until the products appear. Off = nothing until the page is ready."
        />
        {on && (
          <>
            <div className="cst-loader-preview" data-testid="loader-preview" dangerouslySetInnerHTML={{ __html: preview }} />
            <StylePicker label="Style" value={settings.style} options={STYLES} onChange={(v) => updateConfig('loader_style', v)} />
            {ColorPickerField && (
              <div className="cst-grid-2">
                <ColorPickerField label="Loader colour" value={val(config, 'loader_color')} onChange={(v) => updateConfig('loader_color', v)} />
                {settings.style === 'ring' && <ColorPickerField label="Ring track" value={val(config, 'loader_track')} onChange={(v) => updateConfig('loader_track', v)} />}
                <ColorPickerField label="Background" value={val(config, 'loader_bg')} onChange={(v) => updateConfig('loader_bg', v)} />
                <ColorPickerField label="Text colour" value={val(config, 'loader_text_color')} onChange={(v) => updateConfig('loader_text_color', v)} />
              </div>
            )}
            <Slider config={config} updateConfig={updateConfig} keyName="loader_size" label={settings.style === 'dots' ? 'Dots size' : 'Loader size'} min={20} max={120} />
            <BlockStack gap="200">
              <Text as="h6" variant="headingSm">Your logo (optional)</Text>
              <LogoUploader
                label="Loader logo"
                value={config.loader_logo || ''}
                onChange={(v) => updateConfig('loader_logo', v)}
                helpText="A square logo on a transparent background looks best. We resize uploads for you."
              />
            </BlockStack>
            {settings.logo && (
              <>
                <Select
                  label="Logo position"
                  options={[
                    { label: settings.style === 'ring' ? 'Inside the ring' : 'In the middle', value: 'inside' },
                    { label: 'Above the loader', value: 'above' },
                  ]}
                  value={settings.logoPlace}
                  onChange={(v) => updateConfig('loader_logo_place', v)}
                />
                <Slider config={config} updateConfig={updateConfig} keyName="loader_logo_size" label="Logo size" min={24} max={200} />
              </>
            )}
            <TextField
              label="Text under the loader" value={config.loader_text || ''} onChange={(v) => updateConfig('loader_text', v)}
              placeholder="e.g. Packing your box…" maxLength={80} autoComplete="off" helpText="Leave empty for no text."
            />
            <Slider config={config} updateConfig={updateConfig} keyName="loader_height" label="Loader area height (of the screen)" min={20} max={100} suffix="%" />
          </>
        )}
      </BlockStack>
    </SectionCard>
  );
}

export const LoaderSection = memo(LoaderSectionComponent);
