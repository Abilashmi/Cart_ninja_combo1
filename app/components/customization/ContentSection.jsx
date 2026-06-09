import { memo } from 'react';
import { FormLayout, TextField, Select, Checkbox, Text, Tooltip, Button } from '@shopify/polaris';
import { MagicIcon } from '@shopify/polaris-icons';
import { SectionCard } from './SectionCard';

function ContentSectionComponent({
  config,
  expanded,
  onToggle,
  updateConfig,
  getStyleKey,
  generatingTitle,
  generatingDescription,
  generateAiSuggestion,
  PxField,
  ColorPickerField,
}) {
  return (
    <SectionCard title="Title & Description" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <Checkbox
          label="Show title & description"
          checked={!!config.show_title_description}
          onChange={(checked) => updateConfig('show_title_description', checked)}
        />
        {config.show_title_description && (
          <>
            {config.layout === 'layout2' && (
              <TextField label="Header Title (Sticky Top)" value={config.header_title || ''} onChange={(v) => updateConfig('header_title', v)} autoComplete="off" />
            )}
            <div className="cst-field-with-ai">
              <TextField
                label="Collection Title"
                value={config.collection_title}
                onChange={(v) => updateConfig('collection_title', v)}
                autoComplete="off"
                connectedRight={
                  <Tooltip content="Generate text">
                    <Button
                      size="slim" variant="secondary" icon={MagicIcon}
                      accessibilityLabel="Generate title"
                      className="cst-ai-btn"
                      loading={generatingTitle}
                      disabled={generatingTitle || generatingDescription}
                      onClick={() => generateAiSuggestion('title')}
                    />
                  </Tooltip>
                }
              />
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Title Styling</Text>
              <Select label="Alignment" options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }]} value={config[getStyleKey('heading_align')] || 'left'} onChange={(v) => updateConfig(getStyleKey('heading_align'), v)} />
              <Select label="Font Weight" options={[{ label: 'Normal (400)', value: '400' }, { label: 'Medium (500)', value: '500' }, { label: 'Semi-Bold (600)', value: '600' }, { label: 'Bold (700)', value: '700' }, { label: 'Extra Bold (800)', value: '800' }]} value={String(config[getStyleKey('heading_font_weight')] || config.heading_font_weight || '700')} onChange={(v) => updateConfig(getStyleKey('heading_font_weight'), v)} />
              {PxField && <PxField label="Size" value={config[getStyleKey('heading_size')] ?? config.heading_size} onChange={(v) => updateConfig(getStyleKey('heading_size'), v)} />}
              {ColorPickerField && <ColorPickerField label="Color" value={config[getStyleKey('heading_color')] || config.heading_color} onChange={(v) => updateConfig(getStyleKey('heading_color'), v)} />}
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Title Padding (px)</Text>
              <div className="cst-grid-4">
                {PxField && <PxField label="Top" value={config[getStyleKey('title_container_padding_top')] ?? config.title_container_padding_top} onChange={(v) => updateConfig(getStyleKey('title_container_padding_top'), v)} />}
                {PxField && <PxField label="Right" value={config[getStyleKey('title_container_padding_right')] ?? config.title_container_padding_right} onChange={(v) => updateConfig(getStyleKey('title_container_padding_right'), v)} />}
                {PxField && <PxField label="Bottom" value={config[getStyleKey('title_container_padding_bottom')] ?? config.title_container_padding_bottom} onChange={(v) => updateConfig(getStyleKey('title_container_padding_bottom'), v)} />}
                {PxField && <PxField label="Left" value={config[getStyleKey('title_container_padding_left')] ?? config.title_container_padding_left} onChange={(v) => updateConfig(getStyleKey('title_container_padding_left'), v)} />}
              </div>
            </div>

            <div className="cst-section-divider">
              <Text variant="headingSm" as="h6">Description Styling</Text>
              <div className="cst-field-with-ai">
                <TextField
                  label="Collection Description"
                  value={config.collection_description}
                  onChange={(v) => updateConfig('collection_description', v)}
                  autoComplete="off"
                  multiline={2}
                  connectedRight={
                    <Tooltip content="Generate text">
                      <Button
                        size="slim" variant="secondary" icon={MagicIcon}
                        accessibilityLabel="Generate description"
                        className="cst-ai-btn"
                        loading={generatingDescription}
                        disabled={generatingTitle || generatingDescription}
                        onClick={() => generateAiSuggestion('description')}
                      />
                    </Tooltip>
                  }
                />
              </div>
              <Select label="Alignment" options={[{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }]} value={config[getStyleKey('description_align')] || 'left'} onChange={(v) => updateConfig(getStyleKey('description_align'), v)} />
              <Select label="Font Weight" options={[{ label: 'Normal (400)', value: '400' }, { label: 'Medium (500)', value: '500' }, { label: 'Semi-Bold (600)', value: '600' }]} value={String(config[getStyleKey('description_font_weight')] || config.description_font_weight || '400')} onChange={(v) => updateConfig(getStyleKey('description_font_weight'), v)} />
              {PxField && <PxField label="Size" value={config[getStyleKey('description_size')] ?? config.description_size} onChange={(v) => updateConfig(getStyleKey('description_size'), v)} />}
              {ColorPickerField && <ColorPickerField label="Color" value={config[getStyleKey('description_color')] || config.description_color} onChange={(v) => updateConfig(getStyleKey('description_color'), v)} />}
            </div>
          </>
        )}
      </FormLayout>
    </SectionCard>
  );
}

export const ContentSection = memo(ContentSectionComponent);
