import React, { useState, useEffect } from "react";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, BlockStack, Text, Button, ProgressBar, Badge, Banner, IndexTable, Box, Icon, InlineStack } from "@shopify/polaris";
import { AlertCircleIcon, CreditCardIcon, CheckCircleIcon, ChartVerticalIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlan, confirmPlanFromWebhook } from "../services/plan-permissions.server";
import { PLANS } from "../config/plans";

// Shopify redirects here (`returnUrl` in app.subscribe.jsx's
// appSubscriptionCreate) right after the merchant approves a subscription.
// The app_subscriptions/update webhook is what normally promotes
// pending_plan_key -> plan_key, but its arrival isn't guaranteed to beat
// this redirect — so verify directly against Shopify's own subscription
// state here and reconcile the DB immediately if the webhook hasn't landed
// yet. confirmPlanFromWebhook is idempotent, so this is safe to run even
// when the webhook already did it.
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  if (!session) return { redirect: "/auth" };
  const shop = session.shop;

  try {
    const res = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions { id status }
        }
      }
    `);
    const data = await res.json();
    const activeSub = (data.data?.currentAppInstallation?.activeSubscriptions || [])
      .find((s) => s.status === "ACTIVE");
    if (activeSub) {
      await confirmPlanFromWebhook(shop, "active");
    }
  } catch (e) {
    console.error("[Billing loader] Failed to verify subscription:", e.message);
  }

  const planKey = await getShopPlan(shop, admin);
  return { shop, planKey };
}

export default function BillingDashboard() {
  const { planKey } = useLoaderData();
  const plan = PLANS[planKey] || PLANS.free;
  const [today, setToday] = useState(null);
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chargeLoading, setChargeLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/billing/get-usage")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setToday(d.data.today);
        } else {
          setError(d.error || "Failed to load usage data");
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/billing/charges")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setCharges(d.data.history || []);
        }
      })
      .catch(e => console.error("Failed to load charges:", e));
  }, []);

  const handleCreateCharge = async () => {
    setChargeLoading(true);
    try {
      const r = await fetch("/api/billing/trigger-charge", { method: "POST" });
      const d = await r.json();
      if (d.success) {
        setError(null);
        // Refresh data
        setTimeout(() => location.reload(), 1500);
      } else {
        setError(d.error || "Failed to create charge");
      }
    } catch (e) {
      setError(e.message);
    }
    setChargeLoading(false);
  };

  if (loading) {
    return (
      <Page title="Billing Dashboard">
        <Card padding="600">
          <Text>Loading billing data...</Text>
        </Card>
      </Page>
    );
  }

  if (!today) {
    return (
      <Page title="Billing Dashboard">
        <Card padding="600">
          <Banner tone="critical">No usage data available</Banner>
        </Card>
      </Page>
    );
  }

  const unlimited = today.unlimited || plan.orderCap === null;
  const freeOrders = today.free_orders ?? plan.orderCap ?? 0;
  const totalOrders = today.total_orders || 0;
  const overageOrders = today.overage_orders || 0;
  const pendingCharge = today.pending_charge || 0;
  const fbtOrders = today.fbt_orders || 0;
  const comboOrders = today.combo_orders || 0;
  const otherOrders = today.other_orders ?? Math.max(0, totalOrders - fbtOrders - comboOrders);
  const percentUsed = unlimited ? 0 : (totalOrders > 0 ? (totalOrders / freeOrders) * 100 : 0);
  const hasOverage = overageOrders > 0;

  return (
    <Page title="Billing Dashboard">
      <Layout>
        <Layout.Section>
          {error && <Banner tone="critical">{error}</Banner>}

          {/* Today's Usage Card */}
          <Card padding="600">
            <BlockStack gap="500">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" fontWeight="bold">Today's Usage</Text>
                <Badge tone="info">{new Date().toLocaleDateString()}</Badge>
              </InlineStack>

              {/* Progress Bar */}
              {!unlimited && (
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodySm" tone="subdued">Orders: {totalOrders} / {freeOrders} (free)</Text>
                    <Text variant="bodySm" tone="subdued">{percentUsed.toFixed(1)}%</Text>
                  </InlineStack>
                  <ProgressBar
                    progress={Math.min(percentUsed / 100, 1)}
                    tone={hasOverage ? "critical" : "success"}
                    size="large"
                  />
                </BlockStack>
              )}

              {unlimited && (
                <Text variant="bodySm" tone="subdued">Orders today: {totalOrders} — unlimited on the {plan.label} plan, no overage charges.</Text>
              )}

              {/* Source breakdown — reporting only. Buckets can overlap (an
                  order can involve both FBT and Combo), so they aren't summed
                  into the charge; the charge always uses totalOrders alone. */}
              {totalOrders > 0 && (
                <InlineStack gap="200" wrap>
                  <Badge tone="info">{`Frequently Bought Together: ${fbtOrders}`}</Badge>
                  <Badge tone="info">{`Combo Forge: ${comboOrders}`}</Badge>
                  <Badge>{`Other: ${otherOrders}`}</Badge>
                </InlineStack>
              )}

              {/* Overage Alert */}
              {hasOverage && (
                <Box padding="400" background="bg-surface-critical-subdued" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="start">
                      <Icon source={AlertCircleIcon} tone="critical" />
                      <BlockStack gap="100">
                        <Text fontWeight="bold">Overage Charges</Text>
                        <Text>{overageOrders} orders above limit × ${plan.overageRate.toFixed(2)}/order = <Text fontWeight="bold">${pendingCharge.toFixed(2)}</Text></Text>
                      </BlockStack>
                    </InlineStack>
                    <Button
                      onClick={handleCreateCharge}
                      loading={chargeLoading}
                      tone="critical"
                      variant="primary"
                      fullWidth
                    >
                      Record Usage Charge
                    </Button>
                  </BlockStack>
                </Box>
              )}

              {!hasOverage && (
                <Box padding="300" background="bg-surface-success-subdued" borderRadius="200">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={CheckCircleIcon} tone="success" />
                    <Text tone="success">All orders within free limit</Text>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Billing History */}
        <Layout.Section>
          <Card padding="600">
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={ChartVerticalIcon} />
                <Text variant="headingMd" fontWeight="bold">Billing History</Text>
              </InlineStack>

              {charges.length === 0 ? (
                <Box paddingBlockStart="400">
                  <Text tone="subdued">No charges yet</Text>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "charge", plural: "charges" }}
                  itemCount={charges.length}
                  selectable={false}
                  headings={[
                    { title: "Date" },
                    { title: "Orders" },
                    { title: "Amount" },
                    { title: "Status" }
                  ]}
                >
                  {charges.map((charge, idx) => (
                    <IndexTable.Row key={idx} position={idx} id={charge.id?.toString()}>
                      <IndexTable.Cell>{charge.date}</IndexTable.Cell>
                      <IndexTable.Cell>{charge.overage_orders}</IndexTable.Cell>
                      <IndexTable.Cell>${parseFloat(charge.charge_amount).toFixed(2)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge
                          tone={
                            charge.status === "charged" ? "success" :
                            charge.status === "failed" ? "critical" :
                            "attention"
                          }
                        >
                          {charge.status}
                        </Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pricing Info */}
        <Layout.Section>
          <Card padding="600">
            <BlockStack gap="300">
              <Text variant="headingMd" fontWeight="bold">Usage-Based Billing</Text>
              <Text tone="subdued">
                {unlimited
                  ? `Your ${plan.label} plan includes unlimited orders per day — no overage charges.`
                  : `Your ${plan.label} plan includes ${freeOrders} completed orders per day. Each additional order is charged at $${plan.overageRate.toFixed(2)}. Usage charges are recorded automatically and added to your next monthly invoice — no separate approval needed.`}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
