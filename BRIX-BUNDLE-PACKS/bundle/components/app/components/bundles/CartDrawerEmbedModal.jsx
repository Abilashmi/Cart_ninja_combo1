import { Modal, BlockStack, Text } from '@shopify/polaris';
import { EmbedSteps } from './CartDrawerEmbedBanner';

// Shown right after a combo template is saved, when the "Custom Cart Drawer"
// app embed is not confirmed ON. `checked` is false when the theme couldn't be
// read at all — then we don't claim it's off, we ask the merchant to confirm.
export default function CartDrawerEmbedModal({ open, checked, editorUrl, onContinue }) {
  return (
    <Modal
      open={open}
      onClose={onContinue}
      title="Your template is saved — one more step"
      primaryAction={{ content: 'Open theme editor', url: editorUrl, external: true }}
      secondaryActions={[{ content: 'Continue', onAction: onContinue }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            {checked
              ? 'The Cart Drawer app embed is not turned on in your theme yet. Combo pages are displayed by it, so your combo page will not show to shoppers until it is on.'
              : "We couldn't check whether the Cart Drawer app embed is turned on in your theme. Combo pages are displayed by it, so please make sure it is on."}
          </Text>
          <EmbedSteps />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
