import { Box, BlockStack, InlineStack, Text, Button, Scrollable, Badge } from "@shopify/polaris";
import { XIcon } from "@shopify/polaris-icons";

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function HistorySidebar({ open, conversations, activeId, onSelect, onClose }) {
  return (
    <div className={`ai-history${open ? "" : " ai-history--collapsed"}`}>
      <div className="ai-history-inner">
        <Box padding="400" borderBlockEnd="025">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">History</Text>
            <Button variant="tertiary" icon={XIcon} onClick={onClose} accessibilityLabel="Close history" />
          </InlineStack>
        </Box>

        <Scrollable style={{ flex: 1 }}>
          <BlockStack gap="050" padding="200">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: conv.id === activeId ? "var(--p-color-bg-surface-secondary)" : "transparent",
                  border: "none",
                  borderRadius: "var(--p-border-radius-200)",
                  padding: "var(--p-space-200) var(--p-space-300)",
                  cursor: "pointer",
                  transition: "background var(--p-motion-duration-100) var(--p-motion-ease)",
                }}
              >
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight={conv.id === activeId ? "medium" : "regular"}>
                    {conv.title}
                  </Text>
                  <InlineStack gap="100" blockAlign="center">
                    <Text as="span" variant="bodyXs" tone="subdued">{timeAgo(conv.timestamp)}</Text>
                    {conv.messages?.some((m) => m.type === "metric") && (
                      <Badge size="small" tone="info">Data</Badge>
                    )}
                  </InlineStack>
                </BlockStack>
              </button>
            ))}
          </BlockStack>
        </Scrollable>
      </div>
    </div>
  );
}
