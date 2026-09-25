import { Banner, BlockStack, Text, Link } from '@shopify/polaris';
import { CART_DRAWER_EMBED_NAME } from '../../config/theme-extension';

// The how-to, shared by the dashboard banner and the save-time modal.
export function EmbedSteps() {
  return (
    <BlockStack gap="200">
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        <li>Click <strong>Open theme editor</strong> — it opens on the <strong>App embeds</strong> panel.</li>
        <li>Switch on <strong>{CART_DRAWER_EMBED_NAME}</strong>.</li>
        <li>Click <strong>Save</strong> (top right of the theme editor).</li>
        <li>Come back here — your combo page will now show up on your store.</li>
      </ol>
      <Text as="p" variant="bodySm" tone="subdued">
        You only need to do this once per theme — if you switch themes later, turn it on again in the new one.{' '}
        <Link url="https://www.youtube.com/watch?v=xIogTy1RM-0" target="_blank" removeUnderline={false}>Watch a short video</Link>
      </Text>
    </BlockStack>
  );
}

// Shown on the Build a Combo page while the "Custom Cart Drawer" app embed is
// confirmed OFF in the live theme. Combo pages are rendered by that embed, so
// until it is on, a published combo page shows none of the builder — and a
// first-time merchant has no way to know why. Parent decides when to show it.
export default function CartDrawerEmbedBanner({ editorUrl, onCheckAgain, checking = false }) {
  return (
    <Banner
      tone="warning"
      title="Turn on the Cart Drawer app embed so your combo pages show up"
      action={{ content: 'Open theme editor', url: editorUrl, target: '_blank' }}
      secondaryAction={{ content: checking ? 'Checking…' : "I've turned it on — check again", onAction: onCheckAgain, disabled: checking }}
    >
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">
          Combo pages are displayed by the Cart Drawer app embed. Until it is switched on, your published
          combo pages will not show the combo builder to shoppers.
        </Text>
        <EmbedSteps />
      </BlockStack>
    </Banner>
  );
}
