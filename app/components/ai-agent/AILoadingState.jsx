import { useState, useEffect } from "react";
import { BlockStack, Text, InlineStack } from "@shopify/polaris";

const PHASES = [
  "Analyzing your request...",
  "Scanning Cart Ninja settings...",
  "Applying changes...",
  "Updating your store...",
];

export default function AILoadingState() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="aia-loading">
      <BlockStack gap="200" inlineAlign="center">
        <InlineStack gap="100" align="center">
          <span className="aia-loading-spinner" />
          <Text as="span" variant="bodyMd" tone="subdued">
            {PHASES[phase]}
          </Text>
        </InlineStack>
      </BlockStack>
    </div>
  );
}
