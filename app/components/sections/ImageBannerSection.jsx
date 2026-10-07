import { Card, FormLayout, BlockStack, Text, Select, TextField, Banner } from '@shopify/polaris';
import { useCartEditor } from '../../context/CartEditorContext';
import { FeatureToggle } from '../shared/FeatureToggle';
import { BannerImageField } from './BannerImageField';
import { BANNER_PLACEMENTS, bannerSources } from '../../utils/cart-banner.shared';

// Cart Editor section: a promotional image inside the BRIX Cart Drawer.
export function ImageBannerSection() {
  const { body, updateImageBanner } = useCartEditor();
  const banner = body.imageBanner;
  const hasImage = Boolean(bannerSources(banner.desktopImage, banner.mobileImage));

  return (
    <BlockStack gap="400">
      <Text as="p" variant="bodyMd" tone="subdued">
        Show a promotional image inside the cart drawer.
      </Text>
      <Card>
        <FormLayout>
          <FeatureToggle
            label="Show image banner"
            enabled={banner.enabled}
            onToggle={(v) => updateImageBanner({ enabled: v })}
          />
          {banner.enabled && !hasImage && (
            <Banner tone="info">Add a desktop or mobile image. Until then nothing shows in the drawer.</Banner>
          )}
          <Select
            label="Placement"
            options={BANNER_PLACEMENTS}
            value={banner.placement}
            onChange={(v) => updateImageBanner({ placement: v })}
            helpText="Above and Below Progress Bar follow the bar. Without a progress bar, the banner goes to the top of the cart."
          />
        </FormLayout>
      </Card>
      <Card>
        <FormLayout>
          <BannerImageField
            label="Desktop image"
            value={banner.desktopImage}
            onChange={(v) => updateImageBanner({ desktopImage: v })}
            maxWidth={1600}
            emptyHint="Wide images work best, for example 1200 × 400."
            helpText="Shown on desktops and tablets."
          />
          <BannerImageField
            label="Mobile image"
            value={banner.mobileImage}
            onChange={(v) => updateImageBanner({ mobileImage: v })}
            maxWidth={900}
            emptyHint="Optional, for example 800 × 400."
            helpText="Shown on phones. Leave empty to use the desktop image."
          />
          <TextField
            label="Alt text (optional)"
            value={banner.alt}
            onChange={(v) => updateImageBanner({ alt: v })}
            maxLength={160}
            autoComplete="off"
            helpText="Describes the banner for screen readers, for example “Free shipping on orders over ₹999”."
          />
        </FormLayout>
      </Card>
    </BlockStack>
  );
}
