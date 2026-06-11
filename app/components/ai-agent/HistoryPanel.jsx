import { BlockStack, InlineStack, Text, Button, Badge, Box, EmptyState } from "@shopify/polaris";
import { ReplayIcon } from "@shopify/polaris-icons";

const STATUS_TONE = { applied: "success", restored: "info", previewed: "subdued" };

function formatTimestamp(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export default function HistoryPanel({ history, restoringId, onRestore }) {
    if (history.length === 0) {
        return (
            <EmptyState heading="No AI changes yet" image="">
                <p>Once you apply AI recommendations, they&apos;ll show up here so you can review or restore them anytime.</p>
            </EmptyState>
        );
    }

    return (
        <BlockStack gap="100">
            {history.map((entry) => (
                <Box key={entry.id} background="bg-surface-secondary" borderRadius="200" padding="200">
                    <BlockStack gap="100">
                        <InlineStack align="space-between" blockAlign="center" wrap={false}>
                            <Text as="span" variant="bodySm" fontWeight="medium">
                                {entry.summary || entry.prompt || "AI cart update"}
                            </Text>
                            <InlineStack gap="100" blockAlign="center">
                                {Array.isArray(entry.appliedActions) && entry.appliedActions.length > 0 && (
                                    <span style={{ fontSize: "11px", color: "#65676b" }}>
                                        {entry.appliedActions.map(a => a.action).join(", ")}
                                    </span>
                                )}
                                <Badge tone={STATUS_TONE[entry.status] || "subdued"} size="small">
                                    {entry.status === "restored" ? "Restored" : entry.status === "applied" ? "Applied" : "Previewed"}
                                </Badge>
                            </InlineStack>
                        </InlineStack>

                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodyXs" tone="subdued">{formatTimestamp(entry.timestamp)}</Text>
                            <Button
                                size="micro"
                                icon={ReplayIcon}
                                loading={restoringId === entry.id}
                                disabled={Boolean(restoringId) && restoringId !== entry.id}
                                onClick={() => onRestore(entry.id)}
                            >
                                Restore
                            </Button>
                        </InlineStack>
                    </BlockStack>
                </Box>
            ))}
        </BlockStack>
    );
}
