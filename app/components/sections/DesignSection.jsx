import React from 'react';
import { Card, FormLayout, Select, BlockStack, Text, ButtonGroup, Button } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { SliderField } from '../shared/SliderField';
import { LAYOUT_LIMITS, sanitizeDrawerLayout } from '../../utils/drawer-layout.shared.js';

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

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">Configure the visual appearance of your cart drawer.</Text>
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
