import { useCallback, useEffect, useRef } from "react";
import { Card, Box, BlockStack, InlineStack, Text, TextField, Button, Icon } from "@shopify/polaris";
import { ChatIcon, XIcon } from "@shopify/polaris-icons";

const QUICK_TIPS = [
  { text: "Enable cart drawer", emoji: "\u{1F6D2}" },
  { text: "Conversion rate", emoji: "\u{1F4C8}" },
  { text: "What can you do?", emoji: "\u{1F916}" },
];

export default function GreetingPopover({ input, onInputChange, onActivate, onClose }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleChange = useCallback((val) => {
    onInputChange(val);
    if (val.trim().length > 2) onActivate(val.trim());
  }, [onInputChange, onActivate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey && input.trim().length > 2) {
      e.preventDefault();
      onActivate(input.trim());
    }
  }, [input, onActivate]);

  return (
    <div className="ai-greeting">
      <Card padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="200" blockAlign="center">
              <Box
                background="bg-fill-brand"
                borderRadius="full"
                width="40px"
                height="40px"
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                  <Icon source={ChatIcon} tone="base" />
                </div>
              </Box>
              <BlockStack gap="025">
                <Text as="h2" variant="headingSm" fontWeight="bold">Cart Ninja AI</Text>
                <InlineStack gap="100" blockAlign="center">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--p-color-bg-fill-success)", display: "inline-block" }} />
                  <Text as="span" variant="bodyXs" tone="subdued">Online</Text>
                </InlineStack>
              </BlockStack>
            </InlineStack>
            <Button variant="tertiary" icon={XIcon} onClick={onClose} accessibilityLabel="Close" />
          </InlineStack>

          <Text as="p" variant="bodyMd">
            Hi there! {"\u{1F44B}"} How can I help you today with your store?
          </Text>

          <InlineStack gap="200" wrap>
            {QUICK_TIPS.map((tip) => (
              <button
                key={tip.text}
                onClick={() => onActivate(tip.text)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--p-border-radius-200)",
                  border: "1px solid var(--p-color-border)",
                  background: "var(--p-color-bg-surface)",
                  color: "var(--p-color-text)",
                  fontSize: "var(--p-font-size-300)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  fontWeight: 450,
                }}
              >
                {tip.emoji} {tip.text}
              </button>
            ))}
          </InlineStack>

          <TextField
            ref={inputRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            autoComplete="off"
          />
        </BlockStack>
      </Card>
    </div>
  );
}
