// Sidebar sections of the box combo templates (Quantity / Weight / Value Box). Every setting
// is a flat qs_* key on the combo config; a missing key shows the default
// from the shared kit (app/utils/combo-quickshop.shared.js), which is also
// what the storefront and the preview fall back to.
import { memo } from 'react';
import { BlockStack, Checkbox, ChoiceList, FormLayout, Select, Text, TextField } from '@shopify/polaris';
import { SectionCard } from './SectionCard';
import { createComboWeightCore } from '../../utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../utils/combo-quickshop.shared.js';

const kit = createQuickShopKit(createComboWeightCore());
const val = (config, key) => kit.opt(config, key);
const isOn = (config, key) => kit.on(config, key);

/**
 * Pick one of the built-in SVG icons (no emoji), or paste an https image link.
 * fallback = what the page draws when the value isn't an icon name.
 */
function IconPicker({ label, value, onChange, fallback = 'gift' }) {
  const isUrl = /^https:\/\//.test(value || '');
  const current = isUrl ? '' : kit.iconName(value, fallback);
  return (
    <div>
      <Text as="p" variant="bodySm">{label}</Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }} role="radiogroup" aria-label={label}>
        {kit.ICON_NAMES.map((name) => {
          const on = current === name;
          return (
            <button
              key={name} type="button" role="radio" aria-checked={on} aria-label={name} title={name}
              onClick={() => onChange(name)}
              style={{ width: 34, height: 34, padding: 7, borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#2563eb' : '#d1d5db'}`, background: on ? '#eff6ff' : '#fff', color: on ? '#2563eb' : '#374151' }}
              // eslint-disable-next-line react/no-danger -- the kit's own fixed SVG markup
              dangerouslySetInnerHTML={{ __html: kit.svgIcon(name) }}
            />
          );
        })}
      </div>
      <TextField
        label="Or an image link" value={isUrl ? value : ''} placeholder="https://… (optional)" autoComplete="off"
        onChange={(v) => onChange(v.trim() ? v.trim() : current || fallback)}
      />
    </div>
  );
}

/** One icon per tier, kept as qs_tier_icons ("gift, truck, …"); off = no icons. */
function TierIcons({ config, updateConfig }) {
  const tiers = config.weight_pricing?.tiers || [];
  const saved = String(val(config, 'qs_tier_icons') || '').split(',').map((s) => s.trim());
  const enabled = saved.some(Boolean);
  const count = Math.max(tiers.length, 1);
  const iconAt = (i) => saved[i] || kit.TIER_ICON_ORDER[i % kit.TIER_ICON_ORDER.length];
  const setAt = (i, icon) => {
    const next = Array.from({ length: Math.max(count, saved.length) }, (_, j) => iconAt(j));
    next[i] = icon;
    updateConfig('qs_tier_icons', next.join(', '));
  };
  return (
    <BlockStack gap="300">
      <Checkbox
        label="Icons on the milestones" checked={enabled}
        onChange={(v) => updateConfig('qs_tier_icons', v ? kit.DEFAULTS.qs_tier_icons : '')}
      />
      {enabled && Array.from({ length: count }, (_, i) => (
        <IconPicker
          key={tiers[i]?.id || i} fallback={i}
          label={`Tier ${i + 1}${tiers[i]?.label ? ` · ${tiers[i].label}` : ''}`}
          value={iconAt(i)} onChange={(icon) => setAt(i, icon)}
        />
      ))}
    </BlockStack>
  );
}

/** A row of small visual thumbnails to pick a style from. */
export function StylePicker({ label, value, options, onChange }) {
  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyMd">{label}</Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }} role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
              style={{
                border: on ? '2px solid #2563eb' : '1px solid #d1d5db', borderRadius: 10, background: on ? '#eff6ff' : '#fff',
                padding: '8px 6px 6px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6,
              }}
            >
              <div style={{ height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{o.preview}</div>
              <span style={{ fontSize: 12, fontWeight: on ? 700 : 500, color: '#111827' }}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </BlockStack>
  );
}

const track = { height: 5, borderRadius: 9, background: '#e5e7eb', position: 'relative', width: '100%' };
const fill = (w, color = '#2563eb') => ({ position: 'absolute', left: 0, top: 0, bottom: 0, width: w, borderRadius: 9, background: color });
const dot = (left, on) => ({ position: 'absolute', left, top: '50%', width: 11, height: 11, margin: '-5.5px 0 0 -5.5px', borderRadius: '50%', background: on ? '#16a34a' : '#fff', border: `2px solid ${on ? '#16a34a' : '#cbd5e1'}` });

const TOP_STYLES = [
  { value: 'milestones', label: 'Milestones', preview: <div style={track}><div style={fill('55%')} /><span style={dot('40%', true)} /><span style={dot('90%', false)} /></div> },
  { value: 'bar', label: 'Bar + ticks', preview: <div style={track}><div style={fill('60%')} /><span style={{ ...dot('50%', true), width: 7, height: 7, margin: '-3.5px 0 0 -3.5px' }} /></div> },
  { value: 'steps', label: 'Steps', preview: <div style={{ display: 'flex', gap: 3, width: '100%' }}><div style={{ ...track, background: '#16a34a' }} /><div style={track}><div style={fill('40%')} /></div><div style={track} /></div> },
  { value: 'text', label: 'Text only', preview: <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>Add 2 more…</span> },
  { value: 'none', label: 'Hidden', preview: <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span> },
];

const BAR_STYLES = [
  { value: 'full', label: 'Message + items', preview: <div style={{ width: '100%' }}><div style={{ fontSize: 9, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#16a34a' }} />You unlocked</div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 9 }}>5 Items</span><span style={{ background: '#2563eb', borderRadius: 4, width: 26, height: 10 }} /></div></div> },
  { value: 'slim', label: 'Slim line', preview: <div style={{ width: '100%' }}><div style={track}><div style={fill('60%')} /></div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}><span style={{ fontSize: 9 }}>5 Items</span><span style={{ background: '#2563eb', borderRadius: 4, width: 26, height: 10 }} /></div></div> },
  { value: 'ring', label: 'Ring', preview: <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'space-between' }}><span style={{ width: 20, height: 20, borderRadius: '50%', border: '3px solid #2563eb', borderRightColor: '#e5e7eb', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>5</span><span style={{ background: '#2563eb', borderRadius: 4, width: 26, height: 10 }} /></div> },
  { value: 'compact', label: 'Compact', preview: <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}><span style={{ fontSize: 9 }}>5 · ₹999</span><span style={{ background: '#2563eb', borderRadius: 4, width: 26, height: 10 }} /></div> },
];

function Colors({ config, updateConfig, ColorPickerField, fields }) {
  if (!ColorPickerField) return null;
  return (
    <div className="cst-grid-2">
      {fields.map(([key, label]) => (
        <ColorPickerField key={key} label={label} value={val(config, key)} onChange={(v) => updateConfig(key, v)} />
      ))}
    </div>
  );
}

function Px({ PxField, config, updateConfig, keyName, label, min = 0, max = 40 }) {
  if (!PxField) return null;
  return <PxField label={label} value={Number(val(config, keyName))} min={min} max={max} onChange={(v) => updateConfig(keyName, v)} />;
}

/* ── Layout tab ─────────────────────────────────────────────────────────── */

// The page's collections (col_1..col_N), as the storefront lists them.
function pageHandles(config) {
  const out = [];
  for (let i = 1; i <= Number(config.tab_count || 1); i++) {
    const h = config[`col_${i}`];
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

// Picture collection bar: look, size and an optional picture per collection.
function CollectionPictures({ config, updateConfig, collections = [], PxField }) {
  const own = config.qs_chip_images && typeof config.qs_chip_images === 'object' ? config.qs_chip_images : {};
  const handles = pageHandles(config);
  const setImage = (handle, url) => {
    const next = { ...own };
    if (url) next[handle] = url; else delete next[handle];
    updateConfig('qs_chip_images', next);
  };
  return (
    <BlockStack gap="300">
      <div className="cst-grid-2">
        <Select
          label="Picture shape"
          options={[{ label: 'Circle', value: 'circle' }, { label: 'Rounded square', value: 'rounded' }, { label: 'Square', value: 'square' }]}
          value={val(config, 'qs_chip_image_shape')} onChange={(v) => updateConfig('qs_chip_image_shape', v)}
        />
        <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_chip_image_size" label="Picture size" min={40} max={120} />
      </div>
      {handles.map((h) => {
        const col = collections.find((c) => c.handle === h);
        const value = own[h] || '';
        const bad = value && !kit.httpsUrl(value);
        return (
          <TextField
            key={h}
            label={`${col?.title || h} picture`}
            value={value}
            onChange={(v) => setImage(h, v.trim())}
            placeholder="https://… (optional)"
            autoComplete="off"
            error={bad ? 'Use an https:// image link.' : undefined}
            helpText={value ? undefined : col?.image ? 'Empty = the collection\'s own image.' : 'Empty = the first product\'s image (this collection has no image in Shopify).'}
          />
        );
      })}
    </BlockStack>
  );
}

function FiltersSectionComponent({ config, updateConfig, expanded, onToggle, collections, PxField }) {
  const source = val(config, 'qs_chips_source');
  const toggleWithLabel = (key, labelKey, title, help) => (
    <BlockStack gap="100">
      <Checkbox label={title} checked={isOn(config, key)} onChange={(v) => updateConfig(key, v)} helpText={help} />
      {isOn(config, key) && (
        <TextField label="Label" labelHidden value={val(config, labelKey)} onChange={(v) => updateConfig(labelKey, v)} autoComplete="off" />
      )}
    </BlockStack>
  );
  return (
    <SectionCard title="Filters" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <ChoiceList
          title="Filter chips"
          choices={[
            { label: 'One chip per collection', value: 'collections', helpText: 'Needs two or more collections.' },
            { label: 'Chips from product tags I choose', value: 'tags' },
            { label: 'No chips', value: 'none' },
          ]}
          selected={[source]}
          onChange={([v]) => updateConfig('qs_chips_source', v)}
        />
        {source === 'collections' && (
          <ChoiceList
            title="Collection chips look"
            choices={[
              { label: 'Text chips', value: 'text' },
              { label: 'Pictures with names', value: 'images', helpText: 'A row shoppers swipe to switch collections.' },
            ]}
            selected={[val(config, 'qs_chip_style')]}
            onChange={([v]) => updateConfig('qs_chip_style', v)}
          />
        )}
        {source === 'collections' && val(config, 'qs_chip_style') === 'images' && (
          <CollectionPictures config={config} updateConfig={updateConfig} collections={collections} PxField={PxField} />
        )}
        {source === 'tags' && (
          <TextField
            label="Tags to show as chips" value={config.qs_chip_tags || ''} onChange={(v) => updateConfig('qs_chip_tags', v)}
            placeholder="Boneless, Curry Cut, Drumstick" helpText="Separate with commas. A chip shows products with that Shopify tag." autoComplete="off"
          />
        )}
        {source !== 'none' && (
          <BlockStack gap="100">
            <Checkbox label="“All” chip first" checked={isOn(config, 'qs_show_all_chip')} onChange={(v) => updateConfig('qs_show_all_chip', v)} />
            {isOn(config, 'qs_show_all_chip') && <TextField label="All chip label" labelHidden value={val(config, 'qs_all_label')} onChange={(v) => updateConfig('qs_all_label', v)} autoComplete="off" />}
          </BlockStack>
        )}
        <div className="cst-section-divider"><Text variant="headingSm" as="h6">Dropdown filters</Text></div>
        {toggleWithLabel('qs_filter_type', 'qs_filter_type_label', 'Product type', 'Lists the Shopify product types on the page.')}
        {toggleWithLabel('qs_filter_brand', 'qs_filter_brand_label', 'Brand (vendor)', 'Lists the vendors on the page.')}
        {toggleWithLabel('qs_filter_custom', 'qs_filter_custom_label', 'Your own tag filter', 'A dropdown of tags you choose, e.g. Cut: Boneless, With skin.')}
        {isOn(config, 'qs_filter_custom') && (
          <TextField
            label="Tags in this dropdown" value={config.qs_filter_custom_tags || ''} onChange={(v) => updateConfig('qs_filter_custom_tags', v)}
            placeholder="Boneless, With skin" helpText="Separate with commas." autoComplete="off"
          />
        )}
        {toggleWithLabel('qs_filter_sort', 'qs_filter_sort_label', 'Sort', 'Price, biggest discount, name.')}
        {toggleWithLabel('qs_filter_instock', 'qs_filter_instock_label', '“In stock” chip', 'Hides sold-out products when on.')}
        <Text as="p" variant="bodySm" tone="subdued">A dropdown only shows when the products on the page have at least two values for it.</Text>
      </FormLayout>
    </SectionCard>
  );
}

const cardThumb = (children) => <div style={{ width: 34, height: 30, border: '1px solid #d1d5db', borderRadius: 5, position: 'relative', background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 2, boxSizing: 'border-box' }}>{children}</div>;
const CARD_LAYOUTS = [
  { value: 'quick_add', label: 'Quick add', preview: cardThumb(<span style={{ position: 'absolute', top: 2, right: 2, width: 10, height: 10, borderRadius: 3, border: '1.5px solid #2563eb', color: '#2563eb', fontSize: 9, lineHeight: '8px', textAlign: 'center', fontWeight: 800 }}>+</span>) },
  { value: 'normal', label: 'Add button', preview: cardThumb(<span style={{ height: 7, borderRadius: 2, background: '#2563eb' }} />) },
];

function CardsSectionComponent({ config, updateConfig, expanded, onToggle, PxField }) {
  return (
    <SectionCard title="Product cards" expanded={expanded} onToggle={onToggle} badge={CARD_LAYOUTS.find((c) => c.value === val(config, 'qs_card_layout'))?.label}>
      <FormLayout>
        <StylePicker label="Card layout" value={val(config, 'qs_card_layout')} options={CARD_LAYOUTS} onChange={(v) => updateConfig('qs_card_layout', v)} />
        {val(config, 'qs_card_layout') === 'normal' && (
          <TextField label="Add button text" value={config.qs_add_label ?? val(config, 'qs_add_label')} onChange={(v) => updateConfig('qs_add_label', v)} autoComplete="off" maxLength={24} />
        )}
        <div className="cst-grid-2">
          <Select label="Columns (desktop)" options={['2', '3', '4', '5', '6'].map((v) => ({ label: v, value: v }))} value={String(val(config, 'qs_columns_desktop'))} onChange={(v) => updateConfig('qs_columns_desktop', Number(v))} />
          <Select label="Columns (phone)" options={['1', '2', '3'].map((v) => ({ label: v, value: v }))} value={String(val(config, 'qs_columns_mobile'))} onChange={(v) => updateConfig('qs_columns_mobile', Number(v))} />
        </div>
        <Select
          label="Image shape"
          options={[{ label: 'Square', value: 'square' }, { label: 'Portrait (4:5)', value: 'portrait' }, { label: 'Tall (2:3)', value: 'tall' }, { label: 'Landscape (4:3)', value: 'landscape' }]}
          value={val(config, 'qs_image_ratio')} onChange={(v) => updateConfig('qs_image_ratio', v)}
          helpText="Pick the shape of your product photos so they fill the card. Most clothing photos are Tall (2:3)."
        />
        <Select
          label="Picture fit"
          options={[{ label: 'Show the whole picture', value: 'contain' }, { label: 'Fill the frame (trims the edges)', value: 'cover' }]}
          value={val(config, 'qs_image_fit')} onChange={(v) => updateConfig('qs_image_fit', v)}
          helpText="Whole picture leaves empty bands when the photo's shape differs from the card's."
        />
        <TextField
          label="Small line above the title" value={config.qs_card_eyebrow || ''} onChange={(v) => updateConfig('qs_card_eyebrow', v)}
          placeholder="e.g. 8 MINS or Freshly cut" helpText="Leave empty to hide." autoComplete="off" maxLength={40}
        />
        <Checkbox
          label="Open a product popup on tap"
          helpText="Tapping a card's picture or name shows the product's pictures with thumbnails, full description, options and Add."
          checked={isOn(config, 'qs_product_popup')}
          onChange={(v) => updateConfig('qs_product_popup', v)}
        />
        <Checkbox
          label="Hide decimals in prices"
          helpText="₹1708 instead of ₹1708.20 on cards, the popup, the bottom bar and offer messages. Display only: checkout charges the exact price."
          checked={isOn(config, 'qs_hide_decimals')}
          onChange={(v) => updateConfig('qs_hide_decimals', v)}
        />
        <Checkbox label="Short description under the title" checked={isOn(config, 'qs_show_subtitle')} onChange={(v) => updateConfig('qs_show_subtitle', v)} />
        <Checkbox label="“% OFF” from the compare-at price" checked={isOn(config, 'qs_show_off')} onChange={(v) => updateConfig('qs_show_off', v)} />
        <Checkbox label="Struck-through compare-at price" checked={isOn(config, 'qs_show_compare')} onChange={(v) => updateConfig('qs_show_compare', v)} />
        <Checkbox label="Weight when a product has one variant" checked={isOn(config, 'qs_show_weight')} onChange={(v) => updateConfig('qs_show_weight', v)} />
        <div className="cst-grid-2">
          <TextField label="Badge for products tagged" value={val(config, 'qs_badge_tag')} onChange={(v) => updateConfig('qs_badge_tag', v)} autoComplete="off" helpText="A Shopify tag. Empty = no badge." />
          <TextField label="Badge text" value={val(config, 'qs_badge_text')} onChange={(v) => updateConfig('qs_badge_text', v)} autoComplete="off" />
        </div>
        <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_card_radius" label="Card corners" />
      </FormLayout>
    </SectionCard>
  );
}

/* ── Style tab ──────────────────────────────────────────────────────────── */

function ProgressSectionComponent({ config, updateConfig, expanded, onToggle, ColorPickerField, PxField }) {
  const style = val(config, 'qs_top_style');
  return (
    <SectionCard title="Top progress" expanded={expanded} onToggle={onToggle} badge={TOP_STYLES.find((s) => s.value === style)?.label}>
      <FormLayout>
        <StylePicker label="Style" value={style} options={TOP_STYLES} onChange={(v) => updateConfig('qs_top_style', v)} />
        {style !== 'none' && (
          <>
            <TextField label="Heading" value={val(config, 'qs_top_title')} onChange={(v) => updateConfig('qs_top_title', v)} autoComplete="off" helpText="Empty = no heading. The message under it comes from Advanced → Offer." />
            <Checkbox label="Stays at the top while scrolling" checked={isOn(config, 'qs_top_sticky')} onChange={(v) => updateConfig('qs_top_sticky', v)} />
            {isOn(config, 'qs_top_sticky') && (
              <>
                <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_top_offset" label="Space from the top of the screen" max={300} />
                <Text as="p" variant="bodySm" tone="subdued">On your store it stays just below your theme&apos;s sticky header by itself (also when the header hides while scrolling). This is the least space it keeps; leave 0 unless something still covers it.</Text>
              </>
            )}
            {style !== 'text' && (
              <>
                <Checkbox label="Tier names under the bar" checked={isOn(config, 'qs_top_show_labels')} onChange={(v) => updateConfig('qs_top_show_labels', v)} />
                {style === 'milestones' && <TierIcons config={config} updateConfig={updateConfig} />}
                <div className="cst-grid-2">
                  <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_top_height" label="Bar thickness" min={2} max={24} />
                  <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_top_radius" label="Bar corners" max={999} />
                </div>
              </>
            )}
            <Colors
              config={config} updateConfig={updateConfig} ColorPickerField={ColorPickerField}
              fields={[['qs_top_bg', 'Background'], ['qs_top_text', 'Text'], ['qs_top_track', 'Empty bar'], ['qs_top_fill', 'Filled bar'], ['qs_top_done', 'Unlocked']]}
            />
          </>
        )}
      </FormLayout>
    </SectionCard>
  );
}

function BarSectionComponent({ config, updateConfig, expanded, onToggle, ColorPickerField, PxField, shiprocketEnabled = false }) {
  const style = val(config, 'qs_bar_style');
  return (
    <SectionCard title="Bottom bar" expanded={expanded} onToggle={onToggle} badge={BAR_STYLES.find((s) => s.value === style)?.label}>
      <FormLayout>
        <StylePicker label="Style" value={style} options={BAR_STYLES} onChange={(v) => updateConfig('qs_bar_style', v)} />
        {style !== 'compact' && (
          <>
            <Checkbox label="Unlock message" checked={isOn(config, 'qs_bar_show_message')} onChange={(v) => updateConfig('qs_bar_show_message', v)} />
            {style !== 'ring' && <Checkbox label="Item pictures" checked={isOn(config, 'qs_bar_show_thumbs')} onChange={(v) => updateConfig('qs_bar_show_thumbs', v)} />}
            <Checkbox label="Savings line" checked={isOn(config, 'qs_bar_show_saved')} onChange={(v) => updateConfig('qs_bar_show_saved', v)} helpText="Compare-at savings plus the box discount (only while the box discount is live)." />
          </>
        )}
        {isOn(config, 'qs_bar_show_saved') && style !== 'compact' && (
          <div className="cst-grid-2">
            <TextField label="Savings, more tiers to go" value={val(config, 'qs_saved_text')} onChange={(v) => updateConfig('qs_saved_text', v)} autoComplete="off" helpText="{{saved}} = amount saved" />
            <TextField label="Savings, all unlocked" value={val(config, 'qs_saved_done_text')} onChange={(v) => updateConfig('qs_saved_done_text', v)} autoComplete="off" />
          </div>
        )}
        {style === 'full' && isOn(config, 'qs_bar_show_message') && (
          <BlockStack gap="300">
            <IconPicker label="Icon when unlocked" value={val(config, 'qs_bar_icon_done')} fallback="party" onChange={(v) => updateConfig('qs_bar_icon_done', v)} />
            <IconPicker label="Icon before" value={val(config, 'qs_bar_icon_locked')} fallback="gift" onChange={(v) => updateConfig('qs_bar_icon_locked', v)} />
          </BlockStack>
        )}
        <Checkbox label="Celebrate when a tier unlocks" checked={isOn(config, 'qs_bar_celebrate')} onChange={(v) => updateConfig('qs_bar_celebrate', v)} />
        <div className="cst-section-divider"><Text variant="headingSm" as="h6">Button</Text></div>
        <TextField label="Button text" value={val(config, 'qs_btn_label')} onChange={(v) => updateConfig('qs_btn_label', v)} autoComplete="off" maxLength={30} />
        <div className="cst-grid-2">
          {PxField && <PxField label="Text size" value={Number(config.qs_btn_font_size) || 16} min={12} max={24} onChange={(v) => updateConfig('qs_btn_font_size', v)} />}
          <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_btn_font_size_m" label="Text size on phones" min={11} max={22} />
          <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_btn_pad_y" label="Padding top and bottom" min={6} max={28} />
          <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_btn_pad_x" label="Padding left and right" min={8} max={48} />
        </div>
        <Text as="p" variant="bodySm" tone="subdued">The padding also sizes the COD button next to it. COD&rsquo;s own text size and colours are under COD → Customize → Combo page button.</Text>
        <Select
          label="Button goes to"
          options={[{ label: 'Checkout', value: 'checkout' }, { label: 'Cart page', value: 'cart' }]}
          value={val(config, 'qs_btn_action')} onChange={(v) => updateConfig('qs_btn_action', v)}
          helpText="The box discount applies at checkout either way."
        />
        {shiprocketEnabled && val(config, 'qs_btn_action') === 'checkout' && (
          <Select
            label="Checkout with"
            options={[
              { label: 'Shopify checkout', value: 'shopify' },
              { label: 'Shiprocket, BRIX applies the box discount', value: 'shiprocket' },
              { label: "Shiprocket, my own Shiprocket offer", value: 'shiprocket_own' },
            ]}
            value={val(config, 'qs_checkout_with')} onChange={(v) => updateConfig('qs_checkout_with', v)}
            helpText={val(config, 'qs_checkout_with') === 'shiprocket'
              ? 'BRIX makes a one-time code worth the box discount (single use, 2 hours) and opens Shiprocket with it.'
              : val(config, 'qs_checkout_with') === 'shiprocket_own'
                ? 'Shiprocket opens with no BRIX code: set up a matching offer in Shiprocket yourself, or shoppers pay full price there.'
                : 'Shiprocket can\'t run the box discount itself, so Shopify checkout is the default.'}
          />
        )}
        <Checkbox
          label="Only allow checkout once the first tier is unlocked" checked={isOn(config, 'qs_require_first_tier')}
          onChange={(v) => updateConfig('qs_require_first_tier', v)}
        />
        <Colors
          config={config} updateConfig={updateConfig} ColorPickerField={ColorPickerField}
          fields={[['qs_bar_bg', 'Bar background'], ['qs_bar_text', 'Bar text'], ['qs_bar_save', 'Savings text'], ['qs_bar_icon_bg', 'Icon circle'], ['qs_btn_bg', 'Button'], ['qs_btn_text_color', 'Button text']]}
        />
        <div className="cst-grid-2">
          <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_bar_radius" label="Bar corners" />
          <Px PxField={PxField} config={config} updateConfig={updateConfig} keyName="qs_btn_radius" label="Button corners" />
        </div>
      </FormLayout>
    </SectionCard>
  );
}

function ColorsSectionComponent({ config, updateConfig, expanded, onToggle, ColorPickerField }) {
  return (
    <SectionCard title="Page colours" expanded={expanded} onToggle={onToggle}>
      <FormLayout>
        <Colors
          config={config} updateConfig={updateConfig} ColorPickerField={ColorPickerField}
          fields={[['qs_page_bg', 'Page background'], ['qs_card_bg', 'Card background'], ['qs_text_color', 'Text'], ['qs_accent', 'Accent (+ button, chips)'], ['qs_off_color', '% OFF text'], ['qs_badge_bg', 'Badge']]}
        />
      </FormLayout>
    </SectionCard>
  );
}

export const QuickShopFiltersSection = memo(FiltersSectionComponent);
export const QuickShopCardsSection = memo(CardsSectionComponent);
export const QuickShopProgressSection = memo(ProgressSectionComponent);
export const QuickShopBarSection = memo(BarSectionComponent);
export const QuickShopColorsSection = memo(ColorsSectionComponent);
