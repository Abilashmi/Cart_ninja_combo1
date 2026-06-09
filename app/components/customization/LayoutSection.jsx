import { FormLayout, Select, TextField } from '@shopify/polaris';
import { memo } from 'react';
import { SectionCard } from './SectionCard';

function LayoutSectionComponent({ settings, onChange, collapsed, onToggle }) {
  return (
    <SectionCard title="Layout" collapsed={collapsed} onToggle={onToggle}>
      <FormLayout>
        <Select
          label="Image Ratio"
          options={[
            { label: 'Square', value: 'square' },
            { label: 'Portrait', value: 'portrait' },
            { label: 'Rectangle', value: 'rectangle' },
          ]}
          value={settings.imageRatio}
          onChange={(value) => onChange('imageRatio', value)}
        />
        <TextField
          label="Columns"
          type="number"
          inputMode="numeric"
          value={String(settings.columns)}
          onChange={(value) => onChange('columns', value)}
          autoComplete="off"
          min={1}
          max={6}
        />
      </FormLayout>
    </SectionCard>
  );
}

export const LayoutSection = memo(LayoutSectionComponent);
