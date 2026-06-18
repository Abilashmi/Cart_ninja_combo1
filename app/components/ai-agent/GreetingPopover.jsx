import { useCallback, useEffect, useRef } from "react";
import { Card, Box, BlockStack, InlineStack, Text, TextField, Button, Icon } from "@shopify/polaris";
import { ChatIcon, XIcon } from "@shopify/polaris-icons";

const TIP_ICONS = {
  cart: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 3h2l3 9h7l2-6H8"/><circle cx="8" cy="17" r="1.3"/><circle cx="15" cy="17" r="1.3"/>
    </svg>
  ),
  chart: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 16l4-5 4 3 6-8"/>
    </svg>
  ),
  sparkle: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M10 2l1.5 5H17l-4.5 3 1.5 5L10 12l-4 3 1.5-5L3 7h5.5z"/>
    </svg>
  ),
};

const QUICK_TIPS = [
  { text: "Enable cart drawer", icon: TIP_ICONS.cart },
  { text: "Conversion rate", icon: TIP_ICONS.chart },
  { text: "What can you do?", icon: TIP_ICONS.sparkle },
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
            Connected to Store. Ready for instructions.
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{tip.icon}{tip.text}</span>
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
