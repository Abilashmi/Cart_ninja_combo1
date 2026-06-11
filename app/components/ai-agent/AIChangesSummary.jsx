import { useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Icon,
  Banner,
} from "@shopify/polaris";
import { CheckCircleIcon, UndoIcon } from "@shopify/polaris-icons";

const MODULE_LABELS = {
  cartDrawer: "Cart Drawer",
  freeShippingBar: "Free Shipping Bar",
  trustBadges: "Trust Badges",
  upsells: "Upsells",
  couponUnlock: "Coupon Unlock",
  recommendations: "Recommendations",
  rewards: "Rewards",
  countdownTimer: "Countdown Timer",
  announcementBar: "Announcement Bar",
  styling: "Styling",
};

const ACTION_LABELS = {
  enable: "Enabled",
  disable: "Disabled",
  update: "Updated",
  create: "Created",
  delete: "Deleted",
  reset: "Reset",
};

function SettingsSummary({ settings }) {
  if (!settings) return null;
  const entries = Object.entries(settings).filter(
    ([k, v]) => k !== "enabled" && v !== undefined && v !== null,
  );
  if (entries.length === 0) return null;
  return (
    <InlineStack gap="100" wrap>
      {entries.map(([k, v]) => (
        <Badge key={k} tone="info">
          {k}: {String(v)}
        </Badge>
      ))}
    </InlineStack>
  );
}

export default function AIChangesSummary({ actions, results, onUndo, message }) {
  const hasErrors = results?.some((r) => r.status === "error");
  const allDone = results?.every((r) => r.status === "executed");

  return (
    <div className="aia-changes-summary aia-slide-in">
      <Card>
        <BlockStack gap="300">
          {message && (
            <Text as="p" variant="bodyMd" tone="subdued">
              {message}
            </Text>
          )}
          {(allDone || !hasErrors) && (
            <Banner tone="success" icon={CheckCircleIcon}>
              <Text as="span" fontWeight="bold">
                Changes Applied
              </Text>
            </Banner>
          )}
          {hasErrors && (
            <Banner tone="critical">
              <Text as="span" fontWeight="bold">
                Some changes could not be applied
              </Text>
            </Banner>
          )}

          <BlockStack gap="200">
            {actions.map((a, i) => {
              const moduleName = MODULE_LABELS[a.module] || a.module;
              const actionLabel = ACTION_LABELS[a.action] || a.action;
              const result = results?.[i];
              const isDone = result?.status === "executed";
              const isError = result?.status === "error";

              return (
                <div key={i} className="aia-action-item">
                  <InlineStack gap="200" align="start" blockAlign="center">
                    <span className={"aia-action-icon" + (isDone ? " aia-action-icon--ok" : "") + (isError ? " aia-action-icon--err" : "")}>
                      {isDone ? "\u2713" : isError ? "\u2717" : "\u2022"}
                    </span>
                    <BlockStack gap="050">
                      <InlineStack gap="100" align="start" blockAlign="center">
                        <Text as="span" fontWeight="bold" variant="bodyMd">
                          {moduleName}
                        </Text>
                        <Badge tone={isDone ? "success" : isError ? "critical" : "info"}>
                          {actionLabel}
                        </Badge>
                      </InlineStack>
                      {a.settings && <SettingsSummary settings={a.settings} />}
                    </BlockStack>
                    <div style={{ marginLeft: "auto", flexShrink: 0 }}>
                      {onUndo && a.action !== "delete" && (
                        <Button
                          size="slim"
                          variant="tertiary"
                          icon={UndoIcon}
                          onClick={() => onUndo(a)}
                        >
                          Undo
                        </Button>
                      )}
                    </div>
                  </InlineStack>
                </div>
              );
            })}
          </BlockStack>
        </BlockStack>
      </Card>
    </div>
  );
}
