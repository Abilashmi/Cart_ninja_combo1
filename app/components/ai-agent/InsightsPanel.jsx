import { Box, BlockStack, InlineStack, Text, Button, Icon } from "@shopify/polaris";
import { XIcon, ArrowUpIcon, ArrowDownIcon } from "@shopify/polaris-icons";
import { BarChart } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

export default function InsightsPanel({ insight, onClose, onAskFollowUp }) {
  if (!insight) return null;

  const trendUp = insight.trend === "positive";
  const TrendIcon = trendUp ? ArrowUpIcon : ArrowDownIcon;
  const trendTone = trendUp ? "success" : "critical";

  const chartData = [{
    name: insight.metric,
    data: insight.series.map((s) => ({ key: s.label, value: s.value })),
  }];

  return (
    <div className="ai-insights-panel">
      <div className="ai-insights-inner">
        <Box padding="400" borderBlockEnd="025">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingSm">Insights</Text>
            <Button variant="tertiary" icon={XIcon} onClick={onClose} accessibilityLabel="Close insights" />
          </InlineStack>
        </Box>

        <div className="ai-insights-scroll">
          <BlockStack gap="400" padding="400">
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="400"
            >
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">{insight.metric}</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="heading2xl" fontWeight="bold">{insight.value}</Text>
                  <InlineStack gap="050" blockAlign="center">
                    <Icon source={TrendIcon} tone={trendTone} />
                    <Text as="span" variant="bodyMd" tone={trendTone} fontWeight="medium">
                      {trendUp ? "+" : ""}{insight.delta}%
                    </Text>
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Box>

            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
            >
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" tone="subdued">Trend</Text>
                <div style={{ height: 200 }}>
                  <BarChart
                    data={chartData}
                    type="default"
                    xAxisOptions={{ labelFormatter: (v) => v }}
                    yAxisOptions={{ labelFormatter: (v) => `${v}${insight.metric === "Conversion Rate" ? "%" : ""}` }}
                  />
                </div>
              </BlockStack>
            </Box>

            <Button
              variant="tertiary"
              onClick={() => onAskFollowUp("Break down by source")}
            >
              Break down by source \u2192
            </Button>
          </BlockStack>
        </div>
      </div>
    </div>
  );
}
