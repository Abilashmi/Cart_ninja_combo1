import { useMemo, useState } from "react";
import {
    Card, BlockStack, InlineStack, Text, Button, Icon, Badge, Divider, Box,
} from "@shopify/polaris";
import { CheckCircleIcon, MagicIcon } from "@shopify/polaris-icons";

const STATE_LABELS = {
    drawerEnabled: ["Drawer", (v) => (v ? "On" : "Off")],
    "upsell.enabled": ["Upsell recommendations", (v) => (v ? "On" : "Off")],
    "goalBar.enabled": ["Free shipping goal bar", (v) => (v ? "On" : "Off")],
    "trustBadges.enabled": ["Trust badges", (v) => (v ? "On" : "Off")],
    "fbt.enabled": ["Frequently bought together", (v) => (v ? "On" : "Off")],
};

function getAt(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function BeforeAfterRow({ path, before, after }) {
    const [label, format] = STATE_LABELS[path] || [path, (v) => String(v)];
    const beforeVal = getAt(before, path);
    const afterVal = getAt(after, path);
    if (beforeVal === afterVal) return null;

    return (
        <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm">{label}</Text>
            <InlineStack gap="150" blockAlign="center">
                <Badge tone={beforeVal ? "success" : undefined}>{format(beforeVal)}</Badge>
                <Text as="span" tone="subdued">→</Text>
                <Badge tone={afterVal ? "success" : "critical"}>{format(afterVal)}</Badge>
            </InlineStack>
        </InlineStack>
    );
}

function BeforeAfterPanel({ before, after }) {
    if (!before || !after) return null;
    const rows = Object.keys(STATE_LABELS);

    return (
        <Box background="bg-surface-secondary" borderRadius="200" padding="300">
            <BlockStack gap="200">
                <Text as="h4" variant="headingSm">Before / After</Text>
                {rows.map((path) => (
                    <BeforeAfterRow key={path} path={path} before={before} after={after} />
                ))}
            </BlockStack>
        </Box>
    );
}

export default function PlanPreviewCard({
    plan,
    loading,
    applying,
    previewResult,
    applyResult,
    onPreview,
    onApply,
    onCancel,
}) {
    const [showImpact, setShowImpact] = useState(true);

    const items = plan?.items || [];
    const hasActions = items.length > 0;

    const comparison = useMemo(() => {
        if (applyResult?.before && applyResult?.after) return applyResult;
        if (previewResult?.before && previewResult?.after) return previewResult;
        return null;
    }, [previewResult, applyResult]);

    if (!plan) return null;

    return (
        <Card>
            <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                    <InlineStack gap="200" blockAlign="center">
                        <Icon source={MagicIcon} tone="magic" />
                        <Text as="h3" variant="headingMd">AI Recommendations</Text>
                    </InlineStack>
                    {applyResult?.synced === false && (
                        <Badge tone="warning">Saved locally — will sync when the connection returns</Badge>
                    )}
                    {applyResult?.synced && <Badge tone="success">Applied</Badge>}
                </InlineStack>

                <Text as="p" variant="bodyMd">{plan.summary}</Text>

                {hasActions && (
                    <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                            <Text as="h4" variant="headingSm">Changes AI Will Apply</Text>
                            <Button variant="plain" onClick={() => setShowImpact((v) => !v)}>
                                {showImpact ? "Hide impact notes" : "Show impact notes"}
                            </Button>
                        </InlineStack>
                        <BlockStack gap="150">
                            {items.map((item) => (
                                <InlineStack key={item.action} gap="200" blockAlign="start" wrap={false}>
                                    <Box paddingBlockStart="050"><Icon source={CheckCircleIcon} tone="success" /></Box>
                                    <BlockStack gap="050">
                                        <Text as="span" variant="bodyMd" fontWeight="medium">{item.label}</Text>
                                        {showImpact && (
                                            <Text as="span" variant="bodySm" tone="subdued">{item.impact}</Text>
                                        )}
                                    </BlockStack>
                                </InlineStack>
                            ))}
                        </BlockStack>
                    </BlockStack>
                )}

                {comparison && (
                    <>
                        <Divider />
                        <BeforeAfterPanel before={comparison.before?.cart ? { ...comparison.before.cart, fbt: comparison.before.fbt } : null}
                                          after={comparison.after?.cart ? { ...comparison.after.cart, fbt: comparison.after.fbt } : null} />
                        <Box background="bg-surface-magic" borderRadius="200" padding="300">
                            <InlineStack gap="200" blockAlign="start" wrap={false}>
                                <Icon source={MagicIcon} tone="info" />
                                <Text as="span" variant="bodySm">
                                    Estimated impact: these changes are most often associated with stronger average order
                                    value and lower cart abandonment — see the impact notes above for details on each change.
                                </Text>
                            </InlineStack>
                        </Box>
                    </>
                )}

                {hasActions && (
                    <InlineStack gap="200">
                        <Button onClick={onPreview} loading={loading === "preview"} disabled={loading === "apply" || applying}>
                            Preview Changes
                        </Button>
                        <Button
                            variant="primary"
                            onClick={onApply}
                            loading={loading === "apply" || applying}
                            disabled={loading === "preview"}
                        >
                            Apply Changes
                        </Button>
                        <Button variant="plain" onClick={onCancel} disabled={loading || applying}>
                            Cancel
                        </Button>
                    </InlineStack>
                )}
            </BlockStack>
        </Card>
    );
}
