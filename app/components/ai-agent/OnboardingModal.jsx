import { Modal, BlockStack, Text, InlineGrid, Button } from "@shopify/polaris";
import { ONBOARDING_GOALS } from "./constants";

export default function OnboardingModal({ open, onClose, onSelectGoal }) {
    return (
        <Modal open={open} onClose={onClose} title="Welcome to Cart Ninja AI">
            <Modal.Section>
                <BlockStack gap="400">
                    <Text as="p" variant="bodyMd" tone="subdued">
                        What would you like to improve today? Pick a goal and we&apos;ll write a starter prompt for you —
                        you can edit it before sending.
                    </Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                        {ONBOARDING_GOALS.map((goal) => (
                            <Button key={goal.key} fullWidth onClick={() => onSelectGoal(goal)}>
                                {goal.label}
                            </Button>
                        ))}
                    </InlineGrid>
                    <Button variant="plain" onClick={onClose}>
                        Skip for now — I&apos;ll explore on my own
                    </Button>
                </BlockStack>
            </Modal.Section>
        </Modal>
    );
}
