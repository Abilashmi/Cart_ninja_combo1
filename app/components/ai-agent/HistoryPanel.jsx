import { Card, BlockStack, InlineStack, Text, Button, Badge, Box, Icon, EmptyState } from "@shopify/polaris";
import { ClockIcon, ReplayIcon } from "@shopify/polaris-icons";

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
    return (
        <Card>
            <BlockStack gap="300">
                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <Icon source={ClockIcon} />
                    <Text as="h3" variant="headingMd">AI History</Text>
                </div>

                {history.length === 0 ? (
                    <EmptyState
                        heading="No AI changes yet"
                        image=""
                    >
                        <p>Once you apply AI recommendations, they&apos;ll show up here so you can review or restore them anytime.</p>
                    </EmptyState>
                ) : (
                    <BlockStack gap="200">
                        {history.map((entry) => (
                            <Box key={entry.id} background="bg-surface-secondary" borderRadius="200" padding="300">
                                <BlockStack gap="150">
                                    <InlineStack align="space-between" blockAlign="start" wrap={false}>
                                        <BlockStack gap="050">
                                            <Text as="span" variant="bodyMd" fontWeight="medium">
                                                {entry.summary || entry.prompt || "AI cart update"}
                                            </Text>
                                            {entry.prompt && (
                                                <Text as="span" variant="bodySm" tone="subdued">“{entry.prompt}”</Text>
                                            )}
                                        </BlockStack>
                                        <Badge tone={STATUS_TONE[entry.status] || "subdued"}>
                                            {entry.status === "restored" ? "Restored" : entry.status === "applied" ? "Applied" : "Previewed"}
                                        </Badge>
                                    </InlineStack>

                                    {Array.isArray(entry.appliedActions) && entry.appliedActions.length > 0 && (
                                        <InlineStack gap="100" wrap>
                                            {entry.appliedActions.map((a) => (
                                                <Badge key={a.action}>{a.action}</Badge>
                                            ))}
                                        </InlineStack>
                                    )}

                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="span" variant="bodySm" tone="subdued">{formatTimestamp(entry.timestamp)}</Text>
                                        <Button
                                            size="slim"
                                            icon={ReplayIcon}
                                            loading={restoringId === entry.id}
                                            disabled={Boolean(restoringId) && restoringId !== entry.id}
                                            onClick={() => onRestore(entry.id)}
                                        >
                                            Restore these changes
                                        </Button>
                                    </InlineStack>
                                </BlockStack>
                            </Box>
                        ))}
                    </BlockStack>
                )}
            </BlockStack>
        </Card>
    );
}
