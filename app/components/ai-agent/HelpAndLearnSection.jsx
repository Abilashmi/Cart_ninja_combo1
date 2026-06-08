import { useState, useCallback } from "react";
import {
    Button, Icon, Modal, BlockStack, InlineStack, Text, List,
} from "@shopify/polaris";
import { QuestionCircleIcon, ChatIcon, LightbulbIcon } from "@shopify/polaris-icons";
import { EXAMPLE_PROMPTS } from "./constants";

export default function HelpAndLearnSection({ onUsePrompt }) {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);

    return (
        <>
            <Button icon={QuestionCircleIcon} onClick={() => setOpen(true)}>
                How to use AI
            </Button>
            <Modal
                open={open}
                onClose={close}
                title="How to use AI"
                primaryAction={{ content: "Got it", onAction: close }}
            >
                <Modal.Section>
                    <BlockStack gap="400">
                        <Text as="p" variant="bodyMd" tone="subdued">
                            Describe what you want, review the plan, then apply the changes.
                        </Text>

                        <BlockStack gap="200">
                            <Text as="h4" variant="headingSm">3 simple steps</Text>
                            <div style={{ paddingLeft: "20px" }}>
                                <List type="number">
                                    <List.Item>Write a prompt or pick a quick action</List.Item>
                                    <List.Item>Review the AI-generated plan</List.Item>
                                    <List.Item>Preview and apply changes</List.Item>
                                </List>
                            </div>
                        </BlockStack>

                        <BlockStack gap="200">
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <Icon source={ChatIcon} />
                                <Text as="h4" variant="headingSm">Example prompts</Text>
                            </div>
                            <div style={{ paddingLeft: "28px" }}>
                                <InlineStack gap="100" wrap>
                                    {EXAMPLE_PROMPTS.slice(0, 5).map((text) => (
                                        <Button key={text} size="slim" onClick={() => { onUsePrompt(text); close(); }}>
                                            {text}
                                        </Button>
                                    ))}
                                </InlineStack>
                            </div>
                        </BlockStack>

                        <BlockStack gap="200">
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                <Icon source={LightbulbIcon} />
                                <Text as="h4" variant="headingSm">Tips</Text>
                            </div>
                            <Text as="p" variant="bodySm" tone="subdued">
                                Be specific about what you want. Mention your goals and design preferences for best results.
                            </Text>
                        </BlockStack>
                    </BlockStack>
                </Modal.Section>
            </Modal>
        </>
    );
}
