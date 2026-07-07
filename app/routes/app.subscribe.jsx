import { useActionData, useLoaderData, useNavigation, useSubmit, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import {
    Page, BlockStack, Text, Icon, Divider, Banner, Box, Modal,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon, TargetIcon, EyeCheckMarkIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlan, setPendingPlanKey, confirmPlanFromWebhook } from "../services/plan-permissions.server";
import { PLANS, PLAN_KEYS, FEATURES } from "../config/plans";

// TEMP: while testing plan-switching on a dev store (no real payment
// method, so Shopify's real appSubscriptionCreate approval always fails
// with "cannot accept the provided charge"), skip the real Shopify billing
// flow entirely and just apply the selected plan immediately. Flip this
// back to false (or delete the short-circuit block below) before any real
// merchant uses this — otherwise nobody is ever actually billed.
const TEMP_INSTANT_PLAN_SWITCH = true;

// Ordered feature rows shown on every plan card, pulled from the single
// FEATURES registry — adding/removing a feature there updates this page
// automatically, no copy to maintain here.
const FEATURE_ROWS = Object.keys(FEATURES);

export async function loader({ request }) {
    const { session } = await authenticate.admin(request);
    const currentPlanKey = await getShopPlan(session.shop);
    return { currentPlanKey };
}

export async function action({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const planKey = formData.get("planKey");
    const interval = formData.get("interval") === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";

    if (!PLANS[planKey]) {
        return { error: "Invalid plan selected." };
    }

    if (TEMP_INSTANT_PLAN_SWITCH) {
        await setPendingPlanKey(shop, planKey);
        await confirmPlanFromWebhook(shop, "active");
        return { switched: true, planKey };
    }

    const plan = PLANS[planKey];

    // Every plan (including Free) needs a subscription to carry the AI BRIX
    // credit-overage usage line item — Shopify's appUsageRecordCreate can
    // only attach a charge to a line item inside an active subscription.
    const aiCreditLineItem = {
        plan: {
            appUsagePricingDetails: {
                terms: `$${plan.aiBrixOverageRate.toFixed(2)} per AI BRIX credit above ${plan.aiBrixCredits} credits/month.`,
                cappedAmount: { amount: "1000.00", currencyCode: "USD" },
            },
        },
    };

    async function cancelActiveSubscription() {
        const subRes = await admin.graphql(`
            query {
                currentAppInstallation {
                    activeSubscriptions { id status }
                }
            }
        `);
        const subData = await subRes.json();
        const activeSub = (subData.data?.currentAppInstallation?.activeSubscriptions || [])
            .find(s => s.status === "ACTIVE");
        if (!activeSub) return null;

        const cancelRes = await admin.graphql(`
            mutation AppSubscriptionCancel($id: ID!) {
                appSubscriptionCancel(id: $id) {
                    appSubscription { id status }
                    userErrors { field message }
                }
            }
        `, { variables: { id: activeSub.id } });
        const cancelData = await cancelRes.json();
        const userErrors = cancelData.data?.appSubscriptionCancel?.userErrors;
        if (userErrors?.length > 0) return { error: userErrors[0].message };
        return null;
    }

    // Downgrading/selecting Free: cancel any existing paid subscription, then
    // create a usage-only one (no recurring line item) so $0.01/credit AI
    // BRIX overage billing still works on Free.
    if (planKey === "free") {
        try {
            const cancelErr = await cancelActiveSubscription();
            if (cancelErr?.error) {
                return { error: cancelErr.error };
            }

            const mutation = `
                mutation AppSubscriptionCreate(
                    $name: String!
                    $lineItems: [AppSubscriptionLineItemInput!]!
                    $returnUrl: URL!
                    $test: Boolean
                ) {
                    appSubscriptionCreate(
                        name: $name
                        lineItems: $lineItems
                        returnUrl: $returnUrl
                        test: $test
                    ) {
                        userErrors { field message }
                        confirmationUrl
                        appSubscription { id status }
                    }
                }
            `;
            // eslint-disable-next-line no-undef
            const appUrl = process.env.SHOPIFY_APP_URL || "";
            const res = await admin.graphql(mutation, {
                variables: {
                    name: `Cart Ninja ${plan.label} (AI BRIX overage)`,
                    lineItems: [aiCreditLineItem],
                    returnUrl: `${appUrl}/app/billing`,
                    // TEMP: see the paid-plan mutation below for why this is
                    // hardcoded true on dev stores.
                    test: true,
                },
            });
            const data = await res.json();
            const userErrors = data.data?.appSubscriptionCreate?.userErrors;
            if (userErrors?.length > 0) {
                return { error: userErrors[0].message };
            }
            const confirmationUrl = data.data?.appSubscriptionCreate?.confirmationUrl;
            if (!confirmationUrl) {
                return { error: "No confirmation URL returned from Shopify." };
            }
            await setPendingPlanKey(shop, "free");
            return { confirmationUrl };
        } catch (err) {
            return { error: err.message || "Failed to downgrade to Free." };
        }
    }

    const price = interval === "ANNUAL" ? plan.price.annual : plan.price.monthly;

    const lineItems = [
        {
            plan: {
                appRecurringPricingDetails: {
                    price: { amount: price.toFixed(2), currencyCode: "USD" },
                    interval,
                },
            },
        },
    ];

    if (plan.overageRate > 0) {
        lineItems.push({
            plan: {
                appUsagePricingDetails: {
                    terms: `$${plan.overageRate.toFixed(2)} per order above ${plan.orderCap} orders/month.`,
                    cappedAmount: { amount: "1000.00", currencyCode: "USD" },
                },
            },
        });
    }

    lineItems.push(aiCreditLineItem);

    const mutation = `
        mutation AppSubscriptionCreate(
            $name: String!
            $lineItems: [AppSubscriptionLineItemInput!]!
            $returnUrl: URL!
            $trialDays: Int
            $test: Boolean
        ) {
            appSubscriptionCreate(
                name: $name
                lineItems: $lineItems
                returnUrl: $returnUrl
                trialDays: $trialDays
                test: $test
            ) {
                userErrors { field message }
                confirmationUrl
                appSubscription { id status }
            }
        }
    `;

    // eslint-disable-next-line no-undef
    const appUrl = process.env.SHOPIFY_APP_URL || "";
    const variables = {
        name: `Cart Ninja ${plan.label}`,
        lineItems,
        returnUrl: `${appUrl}/app/billing`,
        trialDays: 14,
        // TEMP: hardcoded true so plan-switching can be tested on a dev store
        // (dev stores have no real payment method, so a non-test charge is
        // always rejected at approval with "cannot accept the provided
        // charge"). Must be replaced with a real prod/dev condition before
        // launch, or paying merchants will never actually be billed.
        test: true,
    };

    const res = await admin.graphql(mutation, { variables });
    const data = await res.json();

    const userErrors = data.data?.appSubscriptionCreate?.userErrors;
    if (userErrors?.length > 0) {
        return { error: userErrors[0].message };
    }

    const confirmationUrl = data.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
        return { error: "No confirmation URL returned from Shopify." };
    }

    // Record the intended plan now, before the merchant confirms on
    // Shopify's page — the app_subscriptions/update webhook promotes this
    // to shops.plan_key once the subscription actually becomes active.
    await setPendingPlanKey(shop, planKey);

    return { confirmationUrl };
}

function featureIcon(state) {
    if (state === 'enabled') return { source: CheckCircleIcon, tone: 'success' };
    if (state === 'preview') return { source: EyeCheckMarkIcon, tone: 'caution' };
    return { source: XCircleIcon, tone: 'critical' };
}

function featureLabelSuffix(state) {
    if (state === 'preview') return ' (Preview only)';
    return '';
}

export default function SubscribePage() {
    const { currentPlanKey } = useLoaderData();
    const actionData = useActionData();
    const navigation = useNavigation();
    const submit = useSubmit();
    const [searchParams] = useSearchParams();
    const highlight = searchParams.get('highlight');
    const isSubmitting = navigation.state === "submitting";
    const [downgradeConfirm, setDowngradeConfirm] = useState(false);

    useEffect(() => {
        if (actionData?.confirmationUrl) {
            setDowngradeConfirm(false);
            window.top.location.href = actionData.confirmationUrl;
        }
    }, [actionData]);

    useEffect(() => {
        if (actionData?.switched) {
            setDowngradeConfirm(false);
        }
    }, [actionData]);

    const handleSelect = (planKey) => {
        if (planKey === currentPlanKey) return;
        if (planKey === 'free') {
            setDowngradeConfirm(true);
            return;
        }
        submit({ planKey, interval: "EVERY_30_DAYS" }, { method: "POST" });
    };

    const confirmDowngrade = () => {
        submit({ planKey: "free" }, { method: "POST" });
    };

    const getBtn = (planKey) => {
        if (planKey === currentPlanKey) return { label: 'Current Plan', variant: 'current' };
        const rank = PLAN_KEYS.indexOf(planKey);
        const currentRank = PLAN_KEYS.indexOf(currentPlanKey);
        if (planKey === 'free') return { label: 'Downgrade to Free', variant: 'downgrade' };
        return { label: rank > currentRank ? `Upgrade to ${PLANS[planKey].label} — 14-day trial` : `Switch to ${PLANS[planKey].label}`, variant: 'upgrade' };
    };

    const btnStyle = (variant) => {
        if (variant === 'current') return { background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', cursor: 'default' };
        return { background: '#1a1a1a', color: '#fff', border: 'none', cursor: 'pointer' };
    };

    return (
        <Page fullWidth>
            {actionData?.error && (
                <Box paddingBlockEnd="400">
                    <Banner tone="critical">{actionData.error}</Banner>
                </Box>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

                <div style={{ textAlign: 'center', paddingTop: 16 }}>
                    <Text as="h1" variant="headingXl" fontWeight="bold">Simple, transparent pricing</Text>
                    <div style={{ marginTop: 8 }}>
                        <Text as="p" variant="bodyMd" tone="subdued">Start free — upgrade as your store grows. No hidden fees.</Text>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, alignItems: 'start' }}>
                    {PLAN_KEYS.map((planKey) => {
                        const p = PLANS[planKey];
                        const isCurrent = planKey === currentPlanKey;
                        const isHighlightPlan = planKey === 'starter';
                        const btn = getBtn(planKey);
                        return (
                            <div key={planKey} style={{ background: '#fff', borderRadius: 16, border: `${isHighlightPlan ? '2px' : '1px'} solid ${isHighlightPlan ? '#1a9de0' : isCurrent ? '#1a1a1a' : '#e5e7eb'}`, boxShadow: isHighlightPlan ? '0 8px 32px rgba(26,157,224,0.14)' : isCurrent ? '0 4px 16px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

                                {isCurrent && (
                                    <div style={{ position: 'absolute', top: 12, right: 12, background: '#1a1a1a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999, letterSpacing: '0.3px' }}>ACTIVE</div>
                                )}

                                <div style={{ padding: '9px 22px', background: isHighlightPlan ? '#1a9de0' : '#f9fafb', borderBottom: `1px solid ${isHighlightPlan ? '#0e8bc8' : '#e5e7eb'}` }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: isHighlightPlan ? '#fff' : '#6b7280', letterSpacing: '0.3px' }}>
                                        {isHighlightPlan ? 'most popular' : planKey === 'pro' ? 'best value' : 'free forever'}
                                    </span>
                                </div>

                                <div style={{ padding: '22px 22px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Text as="h2" variant="headingLg" fontWeight="bold">{p.label}</Text>
                                    <div style={{ marginTop: 2 }}><Text as="p" variant="bodyXs" tone="subdued">{p.tagline}</Text></div>

                                    <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                                        <span style={{ fontSize: 40, fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>${p.price.monthly}</span>
                                        <span style={{ fontSize: 14, color: '#6b7280', marginBottom: 5 }}>/ month</span>
                                    </div>
                                    <Text as="p" variant="bodyXs" tone={isHighlightPlan ? 'success' : 'subdued'}>
                                        {p.price.monthly === 0 ? 'Always free' : 'Billed monthly — cancel anytime'}
                                    </Text>

                                    <Divider />

                                    <div style={{ margin: '14px 0', display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', borderRadius: 8, padding: '9px 14px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}><Icon source={TargetIcon} tone="base" /></span>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                                            {p.orderCap === null ? 'Unlimited orders' : `${p.orderCap} orders / month — then $${p.overageRate.toFixed(2)}/order`}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 20 }}>
                                        {FEATURE_ROWS.map((featureKey) => {
                                            const state = FEATURES[featureKey].states[planKey];
                                            const icon = featureIcon(state);
                                            const isHighlighted = highlight === featureKey;
                                            return (
                                                <div key={featureKey} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: isHighlighted ? '#fffbeb' : 'transparent', borderRadius: 6, padding: isHighlighted ? '2px 4px' : 0 }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                        <Icon source={icon.source} tone={icon.tone} />
                                                    </span>
                                                    <Text as="p" variant="bodyXs" tone={state === 'locked' ? 'subdued' : undefined}>
                                                        {FEATURES[featureKey].label}{featureLabelSuffix(state)}
                                                    </Text>
                                                </div>
                                            );
                                        })}
                                        {planKey !== 'free' && (
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                                <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                    <Icon source={CheckCircleIcon} tone="success" />
                                                </span>
                                                <Text as="p" variant="bodyXs">
                                                    {planKey === 'starter' ? 'Build a Combo — up to 3 templates' : 'Build a Combo — unlimited templates'}
                                                </Text>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                <Icon source={CheckCircleIcon} tone="success" />
                                            </span>
                                            <Text as="p" variant="bodyXs">
                                                AI BRIX — {p.aiBrixCredits} credits / month, then ${p.aiBrixOverageRate.toFixed(2)}/credit
                                            </Text>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                <Icon source={p.watermarkRemovable ? CheckCircleIcon : XCircleIcon} tone={p.watermarkRemovable ? 'success' : 'critical'} />
                                            </span>
                                            <Text as="p" variant="bodyXs" tone={p.watermarkRemovable ? undefined : 'subdued'}>
                                                {p.watermarkRemovable ? 'Remove "Powered by BRIX" watermark' : '"Powered by BRIX" watermark (always on)'}
                                            </Text>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ padding: '0 22px 22px' }}>
                                    <button
                                        onClick={() => handleSelect(planKey)}
                                        disabled={btn.variant === 'current' || isSubmitting}
                                        style={{ width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, transition: 'opacity 0.15s', ...btnStyle(btn.variant) }}
                                        onMouseOver={e => { if (btn.variant !== 'current') e.currentTarget.style.opacity = '0.85'; }}
                                        onMouseOut={e => { e.currentTarget.style.opacity = '1'; }}
                                    >
                                        {isSubmitting ? 'Please wait…' : btn.label}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div style={{ textAlign: 'center', paddingBottom: 8 }}>
                    <Text as="p" variant="bodyXs" tone="subdued">All paid plans include a 14-day free trial. Cancel anytime. No charge until trial ends.</Text>
                </div>

                <div style={{ height: 72 }} />
            </div>

            {downgradeConfirm && (
                <Modal
                    open
                    onClose={() => setDowngradeConfirm(false)}
                    title="Downgrade to Free?"
                    primaryAction={{
                        content: isSubmitting ? 'Downgrading…' : 'Downgrade to Free',
                        onAction: confirmDowngrade,
                        loading: isSubmitting,
                        destructive: true,
                    }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setDowngradeConfirm(false) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="300">
                            <Text as="p">
                                Downgrading cancels your current subscription. Features like Progress Bar, AI Cart
                                Upsell, Full Analytics, Custom CSS, and Build a Combo will be locked. FBT and Coupon
                                Lock Pro will switch to preview-only and stop showing on your storefront. Your saved
                                designs are kept — nothing is deleted.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
