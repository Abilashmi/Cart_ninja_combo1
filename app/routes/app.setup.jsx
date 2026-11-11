import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Badge, Box, Divider, List } from "@shopify/polaris";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

// Your theme extension UUID — used for deep links into the theme editor
const EXTENSION_UUID = "c57aa0a4-9f48-795d-3a28-d57b2bbe1419dcaa27cf";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

export default function SetupPage() {
  const { shop } = useLoaderData();

  // Deep links directly into the theme editor
  const themeEditorAppEmbed = `https://${shop}/admin/themes/current/editor?context=apps&activateExtension=${EXTENSION_UUID}`;
  const themeEditorCartBlock = `https://${shop}/admin/themes/current/editor?template=index&addAppBlockId=${EXTENSION_UUID}/cart_drawer&target=mainSection`;
  const themeEditorCouponBlock = `https://${shop}/admin/themes/current/editor?template=index&addAppBlockId=${EXTENSION_UUID}/coupon_slider&target=mainSection`;

  return (
    <Page
      title="Setup Guide"
      subtitle="Activate Cart Ninja on your store — takes less than 2 minutes"
      primaryAction={{
        content: "Open Theme Editor",
        url: themeEditorAppEmbed,
        target: "_blank",
      }}
    >
      <Layout>

        {/* Step 1 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box
                  background="bg-fill-brand"
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text variant="bodySm" fontWeight="bold" tone="text-inverse" alignment="center">1</Text>
                </Box>
                <Text variant="headingMd" as="h2">Enable Cart Ninja in your theme</Text>
              </InlineStack>

              <Text variant="bodyMd" tone="subdued">
                Cart Ninja uses Shopify's Theme App Extensions — it works without editing any theme code and is compatible with all Online Store 2.0 themes (Dawn, Sense, Refresh, etc.).
              </Text>

              <Text variant="bodyMd">
                Click the button below to open your theme editor. In the left sidebar, click the <strong>puzzle piece icon (App embeds)</strong>, find <strong>Cart Ninja</strong>, and toggle it <strong>ON</strong>.
              </Text>

              <Button url={themeEditorAppEmbed} target="_blank" variant="primary">
                Step 1 — Enable App Embed in Theme Editor
              </Button>

              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <Text variant="bodySm" tone="subdued">
                  ⓘ The App Embeds panel is the puzzle piece icon (🧩) at the bottom of the left sidebar in the Theme Editor.
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 2 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box
                  background="bg-fill-brand"
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text variant="bodySm" fontWeight="bold" tone="text-inverse" alignment="center">2</Text>
                </Box>
                <Text variant="headingMd" as="h2">Add the Cart Drawer block</Text>
              </InlineStack>

              <Text variant="bodyMd" tone="subdued">
                The Cart Drawer block is the main sliding cart that replaces your store's default cart page. Add it to your theme sections for it to appear.
              </Text>

              <Text variant="bodyMd">
                In the Theme Editor, navigate to any page template, click <strong>Add block</strong> inside a section, and select <strong>Cart Ninja → Cart Drawer</strong>. Or use the shortcut below:
              </Text>

              <Button url={themeEditorCartBlock} target="_blank">
                Step 2 — Add Cart Drawer Block
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 3 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box
                  background="bg-fill-brand"
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text variant="bodySm" fontWeight="bold" tone="text-inverse" alignment="center">3</Text>
                </Box>
                <Text variant="headingMd" as="h2">Optionally add more blocks</Text>
              </InlineStack>

              <Text variant="bodyMd" tone="subdued">
                Enhance the cart drawer with additional blocks. Each can be added independently.
              </Text>

              <BlockStack gap="300">
                {[
                  {
                    name: "Coupon Slider",
                    desc: "Shows discount codes inside the cart drawer.",
                    url: themeEditorCouponBlock,
                  },
                  {
                    name: "Product Recommendations (FBT)",
                    desc: "Adds the Frequently Bought Together widget to the product page. Set placement to Custom on the FBT page so the app does not move it.",
                    url: `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${EXTENSION_UUID}/FbtSection&target=mainSection`,
                  },
                  {
                    name: "Star Rating",
                    desc: "Shows product star ratings on cart line items.",
                    url: `https://${shop}/admin/themes/current/editor?template=index&addAppBlockId=${EXTENSION_UUID}/star_rating&target=mainSection`,
                  },
                ].map((block, i) => (
                  <Box key={i} borderWidth="025" borderRadius="200" borderColor="border" padding="300">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge>Block</Badge>
                          <Text variant="headingSm">{block.name}</Text>
                        </InlineStack>
                        <Text variant="bodySm" tone="subdued">{block.desc}</Text>
                      </BlockStack>
                      <Button url={block.url} target="_blank" size="slim">Add</Button>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Step 4 */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box
                  background="bg-fill-brand"
                  borderRadius="full"
                  padding="150"
                  minWidth="32px"
                >
                  <Text variant="bodySm" fontWeight="bold" tone="text-inverse" alignment="center">4</Text>
                </Box>
                <Text variant="headingMd" as="h2">Save and preview</Text>
              </InlineStack>

              <Text variant="bodyMd">
                Click <strong>Save</strong> in the Theme Editor. Open your storefront in a new tab, add any product to the cart — the Cart Ninja drawer will slide in automatically.
              </Text>

              <Button url={`https://${shop}`} target="_blank">
                Preview your store
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Troubleshooting */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Troubleshooting</Text>
              <List type="bullet">
                <List.Item>
                  Your theme must be an Online Store 2.0 theme (Dawn, Sense, Refresh, Craft, etc.). Legacy themes are not supported.
                </List.Item>
                <List.Item>
                  Only add one Cart Drawer block — adding multiple will cause conflicts.
                </List.Item>
                <List.Item>
                  If you switch themes, re-enable the app embed in the new theme from the Theme Editor.
                </List.Item>
                <List.Item>
                  The cart drawer is deactivated by default until you enable the app embed in Step 1 — your theme is unaffected until you turn it on.
                </List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
