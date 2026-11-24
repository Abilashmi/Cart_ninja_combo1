import React from 'react';
import { Card, FormLayout, Select, BlockStack, Text, ButtonGroup, Button, InlineStack } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { SliderField } from '../shared/SliderField';
import { LAYOUT_LIMITS, sanitizeDrawerLayout } from '../../utils/drawer-layout.shared.js';
import { THEME_PRESETS, THEME_DEFAULT_ANGLE, THEME_DEFAULT_CUSTOM, sanitizeDrawerTheme, drawerThemeCss } from '../../utils/drawer-theme.shared.js';
import { ColorField } from './ColorField';

export function DesignSection() {
  const { settings, footer, previewDevice, setPreviewDevice, updateDesign, updateCheckoutButton } = useCartEditor();
  const { design } = settings;
  // The Layout card edits the device the preview shows (its own switch moves
  // the preview too). Saved with the checkout button's style blob
  // (drawer-layout.shared.js): phoneLayout / desktopLayout.
  const device = previewDevice === 'desktop' ? 'desktop' : 'phone';
  const blobKey = device === 'desktop' ? 'desktopLayout' : 'phoneLayout';
  const layout = sanitizeDrawerLayout(footer.checkoutButton[blobKey], device);
  const limits = LAYOUT_LIMITS[device];
  const setLayout = (patch) => updateCheckoutButton({ [blobKey]: { ...layout, ...patch } });
  const group = (title, children) => (
    <BlockStack gap="200">
      <Text as="h4" variant="headingXs" tone="subdued">{title}</Text>
      <BlockStack gap="300">{children}</BlockStack>
    </BlockStack>
  );
  const toggle = (key, label, help) => (
    <BlockStack gap="100">
      <FeatureToggle label={label} enabled={layout[key]} onToggle={(v) => setLayout({ [key]: v })} />
      {help && <Text as="p" variant="bodySm" tone="subdued">{help}</Text>}
    </BlockStack>
  );
  const slider = (key, label, suffix = 'px') => (
    <SliderField
      label={label}
      value={layout[key]}
      min={limits[key][0]}
      max={limits[key][1]}
      step={limits[key][2] || 1}
      suffix={suffix}
      onChange={(v) => setLayout({ [key]: v })}
    />
  );

  // Colour theme: the drawer's background (one colour or a mix of two) and its text.
  const theme = sanitizeDrawerTheme(footer.checkoutButton.theme);
  const setTheme = (patch) => updateCheckoutButton({ theme: sanitizeDrawerTheme({ ...(theme || { preset: 'custom', ...THEME_DEFAULT_CUSTOM }), ...patch }) });
  const swatch = (bg, active, label, onClick, key) => (
    <button
      key={key || label}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{ width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
    >
      <span style={{ width: 44, height: 44, borderRadius: '50%', background: bg, boxSizing: 'border-box', border: active ? '3px solid #303030' : '1px solid #c9cccf', boxShadow: active ? '0 0 0 2px #fff inset' : 'none' }} />
      <span style={{ fontSize: 11, color: active ? '#202223' : '#6d7175', fontWeight: active ? 600 : 400 }}>{label}</span>
    </button>
  );
  const presetBg = (p) => drawerThemeCss({ color1: p.c1, color2: p.c2, angle: THEME_DEFAULT_ANGLE, textColor: '' }).background;

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Configure the visual appearance of your cart drawer.</Text>
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">Colour theme</Text>
            <Text as="p" variant="bodySm" tone="subdued">Pick a ready mix, or make your own. It colours the drawer's background; the cards on it keep their own colours.</Text>
          </BlockStack>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {swatch('#ffffff', !theme, 'White', () => updateCheckoutButton({ theme: null }), 'none')}
            {THEME_PRESETS.map((p) => swatch(presetBg(p), theme?.preset === p.id, p.label, () => setTheme({ preset: p.id, color1: p.c1, color2: p.c2 })))}
            {swatch('conic-gradient(#ff6b6b, #ffd93d, #6bcf7f, #4d96ff, #b86bff, #ff6b6b)', theme?.preset === 'custom', 'Custom', () => setTheme({ preset: 'custom' }))}
          </div>
          {theme && (
            <BlockStack gap="300">
              <Text as="h4" variant="headingXs" tone="subdued">Customise</Text>
              <InlineStack gap="400" wrap={false}>
                <div style={{ flex: 1 }}><ColorField label="Colour 1" value={theme.color1} onChange={(v) => setTheme({ preset: 'custom', color1: v })} /></div>
                {theme.color2 ? (
                  <div style={{ flex: 1 }}><ColorField label="Colour 2" value={theme.color2} onChange={(v) => setTheme({ preset: 'custom', color2: v })} /></div>
                ) : (
                  <div style={{ flex: 1, alignSelf: 'end' }}><Button onClick={() => setTheme({ preset: 'custom', color2: THEME_DEFAULT_CUSTOM.color2 })}>Mix with a second colour</Button></div>
                )}
              </InlineStack>
              {theme.color2 && (
                <BlockStack gap="300">
                  <SliderField label="Mix direction" value={theme.angle} min={0} max={360} step={15} suffix="°" onChange={(v) => setTheme({ preset: 'custom', angle: v })} />
                  <div><Button variant="plain" onClick={() => setTheme({ preset: 'custom', color2: '' })}>Use one colour only</Button></div>
                </BlockStack>
              )}
              <ColorField
                label="Text colour"
                value={theme.textColor}
                allowEmpty
                fallback={drawerThemeCss(theme).color}
                onChange={(v) => setTheme({ textColor: v })}
              />
              <Text as="p" variant="bodySm" tone="subdued">Leave the text colour empty to switch between dark and light text on its own.</Text>
            </BlockStack>
          )}
        </BlockStack>
      </Card>
      <Card>
        <FormLayout>
          <SliderField
            label="Border Radius"
            value={design.borderRadius}
            min={0}
            max={24}
            suffix="px"
            onChange={(v) => updateDesign({ borderRadius: v })}
          />
          <FeatureToggle
            label="Drop Shadow"
            enabled={design.shadow}
            onToggle={(v) => updateDesign({ shadow: v })}
          />
          <Select
            label="Open Animation"
            options={[
              { label: 'Slide', value: 'slide' },
              { label: 'Fade', value: 'fade' },
              { label: 'Bounce', value: 'bounce' },
              { label: 'Zoom', value: 'zoom' },
              { label: 'Push', value: 'push' },
              { label: 'None', value: 'none' },
            ]}
            value={design.animation}
            onChange={(v) => updateDesign({ animation: v })}
          />
        </FormLayout>
      </Card>
      <Card>
        <BlockStack gap="300">
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Layout</Text>
            <ButtonGroup variant="segmented">
              <Button pressed={device === 'phone'} onClick={() => setPreviewDevice('mobile')}>Phone</Button>
              <Button pressed={device === 'desktop'} onClick={() => setPreviewDevice('desktop')}>Desktop</Button>
            </ButtonGroup>
            <Text as="p" variant="bodySm" tone="subdued">
              {device === 'phone'
                ? 'Width and spacing on phones. Less space shows more of the products in the cart.'
                : 'Width and spacing on computers and tablets.'}
            </Text>
          </BlockStack>
          {group('Drawer', <>
            {device === 'phone' ? slider('drawerWidth', 'Drawer width (of the screen)', '%') : slider('drawerWidth', 'Drawer width')}
          </>)}
          {group('Top bars', <>
            {slider('announcementPadding', 'Announcement bar padding')}
            {slider('countdownPadding', 'Countdown bar padding')}
            {slider('headerPadding', 'Header padding')}
          </>)}
          {group('Cart body', <>
            {slider('bodyPadding', 'Content padding')}
            {slider('sectionGap', 'Space between sections')}
          </>)}
          {group('Progress bar', <>
            {slider('progressPadding', 'Padding above and below')}
            {slider('progressHeadingGap', 'Space under the message')}
            {slider('progressHeadingSize', 'Message text size')}
            {slider('progressLabelGap', 'Space under the milestone labels')}
          </>)}
          {group('Products', <>
            {slider('itemPadding', 'Padding inside each product')}
            {slider('itemGap', 'Space between products')}
            {slider('itemImageSize', 'Image size')}
            {slider('itemTitleSize', 'Product name size')}
            {slider('itemPriceSize', 'Price size')}
            {slider('itemTotalSize', 'Line total size')}
            {toggle('showItemsHeading', 'Show "Items included" row')}
          </>)}
          {group('Footer', <>
            {slider('footerPadding', 'Footer padding')}
            {slider('summaryRowGap', 'Space between price rows')}
            {slider('summaryGap', 'Space above the buttons')}
            {slider('buttonGap', 'Space between Checkout and COD')}
            {toggle('foldSummary', 'Fold price details', 'Shows only the Total. Shoppers tap Details to see the subtotal, discounts and the shipping note.')}
            {toggle('showFooterNote', 'Show shipping note', `"${footer.checkoutButton.footerText || 'Shipping and taxes calculated at checkout'}" under the buttons.`)}
          </>)}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
