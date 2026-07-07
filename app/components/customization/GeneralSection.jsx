import { memo } from 'react';
import { FormLayout, TextField, Select, Checkbox, Text, Tooltip, Button } from '@shopify/polaris';
import { MagicIcon } from '@shopify/polaris-icons';
import { SectionCard } from './SectionCard';

function GeneralSectionComponent({
  config,
  collections,
  updateConfig,
  expanded,
  onToggle,
  stepErrors,
  maxProductsError,
  stepFieldAiLoading,
  generateStepFieldSuggestion,
}) {
  const layout = config.layout;

  if (layout === 'layout1') {
    const numSteps = Number(config.max_selections || 1);
    const addStep = () => updateConfig('max_selections', numSteps + 1);
    const removeStep = (step) => {
      updateConfig('max_selections', Math.max(1, numSteps - 1));
      updateConfig(`step_${step}_collection`, '');
      updateConfig(`step_${step}_title`, '');
      updateConfig(`step_${step}_subtitle`, '');
      updateConfig(`step_${step}_limit`, '');
    };
    return (
      <SectionCard
        title="Steps & Collections"
        expanded={expanded}
        onToggle={onToggle}
        badge={`${numSteps} ${numSteps === 1 ? 'collection' : 'collections'}`}
      >
        <FormLayout>
          <div className="cst-bundle-rule-box">
            <Text variant="bodyMd" as="p" fontWeight="bold">Bundle Rule</Text>
            <TextField
              label="Total Products Customer Can Add"
              type="number"
              value={String(config.max_products || 5)}
              onChange={(v) => { updateConfig('max_products', Math.max(1, Number(v))); }}
              autoComplete="off"
              error={maxProductsError}
              helpText="Maximum total products across all collections."
            />
          </div>
          {[...Array(numSteps)].map((_, index) => {
            const step = index + 1;
            return (
              <div key={step} className="cst-step-block">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text variant="bodyMd" as="p" fontWeight="bold">Collection {step}</Text>
                  {numSteps > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(step)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d72c0d', fontSize: 13, fontWeight: 600, padding: '2px 6px' }}
                    >
                      ✕ Remove
                    </button>
                  )}
                </div>
                <div className="cst-step-fields">
                  <TextField
                    label="Title"
                    value={config[`step_${step}_title`] || ''}
                    onChange={(v) => updateConfig(`step_${step}_title`, v)}
                    autoComplete="off"
                    placeholder={`e.g. ${step === 1 ? 'Cleanser' : step === 2 ? 'Toner' : 'Product'}`}
                    connectedRight={
                      <Tooltip content="Generate text">
                        <Button
                          size="slim"
                          variant="secondary"
                          icon={MagicIcon}
                          accessibilityLabel="Generate title text"
                          className="cst-ai-btn"
                          loading={!!stepFieldAiLoading[`${step}_title`]}
                          onClick={() => generateStepFieldSuggestion(step, 'title')}
                        />
                      </Tooltip>
                    }
                  />
                  <TextField
                    label="Subtitle"
                    value={config[`step_${step}_subtitle`] || ''}
                    onChange={(v) => updateConfig(`step_${step}_subtitle`, v)}
                    autoComplete="off"
                    placeholder="e.g. Select one"
                    connectedRight={
                      <Tooltip content="Generate text">
                        <Button
                          size="slim"
                          variant="secondary"
                          icon={MagicIcon}
                          accessibilityLabel="Generate subtitle text"
                          className="cst-ai-btn"
                          loading={!!stepFieldAiLoading[`${step}_subtitle`]}
                          onClick={() => generateStepFieldSuggestion(step, 'subtitle')}
                        />
                      </Tooltip>
                    }
                  />
                  <Select
                    label="Collection"
                    options={[
                      { label: '+ Choose a collection', value: '' },
                      ...(collections || []).map((col) => ({
                        label: col.title,
                        value: col.handle,
                      })),
                    ]}
                    value={config[`step_${step}_collection`] || ''}
                    onChange={(v) => updateConfig(`step_${step}_collection`, v)}
                    error={stepErrors?.[`step_${step}_collection`]}
                  />
                  <TextField
                    label="Selection Limit"
                    type="number"
                    value={config[`step_${step}_limit`] == null ? '' : String(config[`step_${step}_limit`])}
                    onChange={(v) => updateConfig(`step_${step}_limit`, v === '' ? '' : Math.max(1, Number(v)))}
                    autoComplete="off"
                    placeholder="Unlimited"
                    helpText="Leave blank for unlimited"
                  />
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addStep}
            style={{
              width: '100%', padding: '10px', border: '1.5px dashed #c9cccf',
              borderRadius: 8, background: '#f6f6f7', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: '#2c6ecb',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Collection
          </button>
        </FormLayout>
      </SectionCard>
    );
  }

  if (layout === 'layout2') {
    const tabCount = Number(config.tab_count || 1);
    const addTab = () => updateConfig('tab_count', tabCount + 1);
    const removeTab = (i) => {
      updateConfig('tab_count', Math.max(1, tabCount - 1));
      updateConfig(`col_${i}`, '');
    };
    return (
      <SectionCard
        title="Collections (Switching Tabs)"
        expanded={expanded}
        onToggle={onToggle}
        badge={`${tabCount} ${tabCount === 1 ? 'collection' : 'collections'}`}
      >
        <FormLayout>
          <div className="cst-bundle-rule-box">
            <Text variant="bodyMd" as="p" fontWeight="bold">Bundle Rule</Text>
            <TextField
              label="Total Products Customer Can Add"
              type="number"
              value={String(config.max_products || 5)}
              onChange={(v) => { updateConfig('max_products', Math.max(1, Number(v))); }}
              autoComplete="off"
              error={maxProductsError}
            />
          </div>
          <div className="cst-inline-group">
            <Checkbox
              label="Show 'All' Tab"
              checked={!!config.show_tab_all}
              onChange={(v) => updateConfig('show_tab_all', v)}
            />
            <TextField
              label="First Tab Label"
              value={config.tab_all_label || 'Collections'}
              onChange={(v) => updateConfig('tab_all_label', v)}
              autoComplete="off"
            />
          </div>
          <div className="cst-row cst-row--vertical" style={{ marginTop: 12, gap: 10 }}>
            {[...Array(tabCount)].map((_, index) => {
              const i = index + 1;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Select
                      label={`Collection ${i}`}
                      options={[
                        { label: '+ Choose a collection', value: '' },
                        ...(collections || []).map((col) => ({
                          label: col.title,
                          value: col.handle,
                        })),
                      ]}
                      value={config[`col_${i}`] || ''}
                      onChange={(v) => updateConfig(`col_${i}`, v)}
                    />
                  </div>
                  {tabCount > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTab(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d72c0d', fontSize: 13, fontWeight: 600, padding: '8px 4px', marginBottom: 4 }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addTab}
            style={{
              width: '100%', padding: '10px', border: '1.5px dashed #c9cccf',
              borderRadius: 8, background: '#f6f6f7', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: '#2c6ecb',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Collection
          </button>
        </FormLayout>
      </SectionCard>
    );
  }

  if (layout === 'layout3') {
    return (
      <>
        <SectionCard
          title="Hero Deal Card"
          expanded={expanded}
          onToggle={onToggle}
        >
          <FormLayout>
            <Checkbox
              label="Show Deal of the Day"
              checked={config.show_hero !== false}
              onChange={(v) => updateConfig('show_hero', v)}
            />
            {config.show_hero !== false && (
              <>
                <TextField label="Hero Image URL" value={config.hero_image_url || ''} onChange={(v) => updateConfig('hero_image_url', v)} autoComplete="off" placeholder="https://example.com/image.jpg" />
                <TextField label="Hero Title" value={config.hero_title || 'Mega Breakfast Bundle'} onChange={(v) => updateConfig('hero_title', v)} autoComplete="off" />
                <TextField label="Hero Subtitle" value={config.hero_subtitle || 'Milk, Bread, Eggs, Cereal & Juice'} onChange={(v) => updateConfig('hero_subtitle', v)} autoComplete="off" />
                <div className="cst-grid-2">
                  <TextField label="Hero Price" value={config.hero_price || '$14.99'} onChange={(v) => updateConfig('hero_price', v)} autoComplete="off" />
                  <TextField label="Compare Price" value={config.hero_compare_price || '$24.50'} onChange={(v) => updateConfig('hero_compare_price', v)} autoComplete="off" />
                </div>
                <TextField label="Button Text" value={config.hero_btn_text || 'Add to Cart - Save 38%'} onChange={(v) => updateConfig('hero_btn_text', v)} autoComplete="off" />
              </>
            )}
          </FormLayout>
        </SectionCard>

        <SectionCard title="Pricing & Discounts" expanded={expanded} onToggle={onToggle}>
          <FormLayout>
            <div className="cst-bundle-rule-box">
              <Text variant="bodyMd" as="p" fontWeight="bold">Bundle Rule</Text>
              <TextField label="Number of Categories" type="number" value={String(config.col_count || 4)} onChange={(v) => updateConfig('col_count', Math.max(1, Number(v)))} autoComplete="off" />
              <TextField label="Total Products" type="number" value={String(config.max_products || 5)} onChange={(v) => { updateConfig('max_products', Math.max(1, Number(v))); }} autoComplete="off" error={maxProductsError} />
            </div>
            <div className="cst-row">
              {[...Array(config.col_count || 4)].map((_, index) => {
                const i = index + 1;
                return (
                  <Select
                    key={i}
                    label={`Category ${i}`}
                    options={[
                      { label: '-- None --', value: '' },
                      ...(collections || []).map((col) => ({
                        label: col.title,
                        value: col.handle,
                      })),
                    ]}
                    value={config[`col_${i}`] || ''}
                    onChange={(v) => updateConfig(`col_${i}`, v)}
                  />
                );
              })}
            </div>
          </FormLayout>
        </SectionCard>
      </>
    );
  }

  return (
    <SectionCard title="Bundle Rule" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <div className="cst-bundle-rule-box">
          <TextField label="Combo Size" type="number" value={String(config.combo_size || 1)} onChange={(v) => updateConfig('combo_size', Math.max(1, Number(v)))} autoComplete="off" />
          <TextField label="Total Products" type="number" value={String(config.max_products || 5)} onChange={(v) => { updateConfig('max_products', Math.max(1, Number(v))); }} autoComplete="off" error={maxProductsError} />
        </div>
        <Select
          label="Select Collection"
          options={[
            { label: '-- Choose a collection --', value: '' },
            ...(collections || []).map((col) => ({
              label: col.productsCount ? `${col.title} (${col.productsCount})` : col.title,
              value: col.handle,
            })),
          ]}
          value={config.collection_handle || ''}
          onChange={(v) => updateConfig('collection_handle', v)}
        />
      </FormLayout>
    </SectionCard>
  );
}

export const GeneralSection = memo(GeneralSectionComponent);
