import { useActionData, useLoaderData, useNavigation, useSubmit, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import {
    Page, BlockStack, Text, Icon, Divider, Banner, Box, Modal,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon, TargetIcon, EyeCheckMarkIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlan, setPendingPlanKey, hasApprovedSubscription } from "../services/plan-permissions.server";
import { PLANS, PLAN_KEYS, FEATURES } from "../config/plans";

// Ordered feature rows shown on every plan card, pulled from the single
// FEATURES registry — adding/removing a feature there updates this page
// automatically, no copy to maintain here.
const FEATURE_ROWS = Object.keys(FEATURES);

// Shopify's own app handle in the admin (visible in URLs like
// admin.shopify.com/store/{shop}/charges/{appHandle}/... or
// admin.shopify.com/store/{shop}/apps/{appHandle}) — distinct from
// SHOPIFY_API_KEY/client_id, this is a slug Shopify assigns from the app's
// name in the Partner Dashboard.
const SHOPIFY_APP_HANDLE = "cart_app-1";

// Shopify's Billing API returnUrl redirect (after a merchant approves a
// subscription charge) lands as a bare top-level navigation with no
// shop/host params attached — confirmed via logging in auth.login/route.jsx:
// the Referer on that hop is just "https://admin.shopify.com/", no /store/
// path segment to recover the shop from either. authenticate.admin() then
// requires both params and bounces to a bare /auth/login with everything
// stripped, stranding the merchant right after they paid.
//
// Routing returnUrl through Shopify's own admin.shopify.com/store/{shop}/
// apps/{handle}/... URL pattern instead of the bare app domain sidesteps
// this: Shopify's admin wrapper re-establishes host/embedded/shop params
// itself before framing the app page, the same way it does for every
// regular in-admin navigation into an installed app.
function adminAppUrl(shop, path) {
    const shopName = shop.replace(".myshopify.com", "");
    return `https://admin.shopify.com/store/${shopName}/apps/${SHOPIFY_APP_HANDLE}${path}`;
}

// Shopify rejects real (non-test) charges on partner/dev stores with "cannot
// accept the provided charge" since they have no real payment method — test
// must be true there. On production stores it must be false, or merchants
// are never actually billed. Checked live via the Admin API rather than an
// env flag so the same code path is correct in both environments.
async function isPartnerDevelopmentStore(admin) {
    const res = await admin.graphql(`query { shop { plan { partnerDevelopment } } }`);
    const data = await res.json();
    return data.data?.shop?.plan?.partnerDevelopment === true;
}

export async function loader({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const [planKey, approved] = await Promise.all([
        getShopPlan(session.shop, admin),
        hasApprovedSubscription(session.shop, admin),
    ]);
    // planKey defaults to 'free' locally for any shop with no DB row yet —
    // that's a storage default, not a real "current plan." Treating it as
    // one here would mark Free as already-selected/disabled for a shop that
    // has never actually approved anything, blocking the very approval this
    // page exists to collect. Only report a currentPlanKey once there's a
    // real approved subscription behind it.
    const currentPlanKey = approved ? planKey : null;
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

    const isTestCharge = await isPartnerDevelopmentStore(admin);
    const plan = PLANS[planKey];

    // Every plan (including Free) needs a subscription to carry a usage line
    // item — Shopify's appUsageRecordCreate can only attach a charge to a
    // line item inside an active subscription. Order-overage and AI BRIX
    // credit-overage share this single line item rather than each getting
    // their own: Shopify's Billing API rejects appSubscriptionCreate with
    // "Cannot have more than one plan with the same pricing details" the
    // instant a subscription carries a second appUsagePricingDetails line
    // item, regardless of differing `terms`/`cappedAmount` — confirmed via
    // direct GraphiQL testing, not just a same-value collision. Individual
    // charges still identify their type via `description` on each
    // appUsageRecordCreate call (see billing.server.js).
    const usageTerms = [
        plan.overageRate > 0
            ? `$${plan.overageRate.toFixed(2)} per order above ${plan.orderCap} orders/month`
            : null,
        `$${plan.aiBrixOverageRate.toFixed(2)} per AI BRIX credit above ${plan.aiBrixCredits} credits/month`,
    ].filter(Boolean).join(', plus ') + '.';
    const combinedUsageCap = 1000 + 500; // order-overage cap + AI BRIX cap, combined
    const usageLineItem = {
        plan: {
            appUsagePricingDetails: {
                terms: usageTerms,
                cappedAmount: { amount: combinedUsageCap.toFixed(2), currencyCode: "USD" },
            },
        },
    };

    async function fetchActiveSubscriptionIds() {
        const subRes = await admin.graphql(`
            query {
                currentAppInstallation {
                    activeSubscriptions { id status }
                }
            }
        `);
        const subData = await subRes.json();
        // activeSubscriptions returns both ACTIVE and PENDING subscriptions
        // (that's what "active" means in Shopify's Billing API — cancelled/
        // declined/expired ones are already excluded) — a leftover PENDING
        // subscription from an earlier attempt that was never approved on
        // Shopify's confirmation page still counts toward the "same pricing
        // details" conflict, so every entry here needs cancelling, not just
        // ones with status === "ACTIVE".
        return (subData.data?.currentAppInstallation?.activeSubscriptions || []).map(s => s.id);
    }

    async function cancelActiveSubscription() {
        const subIds = await fetchActiveSubscriptionIds();

        for (const id of subIds) {
            const cancelRes = await admin.graphql(`
                mutation AppSubscriptionCancel($id: ID!) {
                    appSubscriptionCancel(id: $id) {
                        appSubscription { id status }
                        userErrors { field message }
                    }
                }
            `, { variables: { id } });
            const cancelData = await cancelRes.json();
            const userErrors = cancelData.data?.appSubscriptionCancel?.userErrors;
            if (userErrors?.length > 0) return { error: userErrors[0].message };
        }

        if (subIds.length === 0) return null;

        // Shopify's Billing API is eventually consistent: appSubscriptionCancel
        // can return success while the cancelled subscription is still visible
        // internally for a brief window, causing the very next
        // appSubscriptionCreate call to fail with "Cannot have more than one
        // plan with the same pricing details" even though activeSubscriptions
        // no longer lists it. Poll until Shopify's own read confirms the
        // cancellation before proceeding, instead of racing it.
        for (let attempt = 0; attempt < 5; attempt++) {
            const remaining = await fetchActiveSubscriptionIds();
            if (remaining.length === 0) return null;
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
        return null;
    }

    // Cancel any existing active subscription before creating a new one for
    // any plan (including switching between two paid plans) — Shopify
    // rejects appSubscriptionCreate with "Cannot have more than one plan
    // with the same pricing details" if an old subscription with identical
    // line items is still active/pending, which silently blocked every
    // plan switch here until this ran unconditionally.
    try {
        const cancelErr = await cancelActiveSubscription();
        if (cancelErr?.error) {
            return { error: cancelErr.error };
        }
    } catch (err) {
        return { error: err.message || "Failed to cancel existing subscription." };
    }

    // Downgrading/selecting Free: create a usage-only subscription (no
    // recurring line item) so order-overage and AI BRIX credit-overage
    // billing still work on Free.
    if (planKey === "free") {
        try {
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
            const res = await admin.graphql(mutation, {
                variables: {
                    name: `Cart Ninja ${plan.label} (usage overage)`,
                    lineItems: [usageLineItem],
                    returnUrl: adminAppUrl(shop, "/app/billing"),
                    test: isTestCharge,
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

    lineItems.push(usageLineItem);

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

    const variables = {
        name: `Cart Ninja ${plan.label}`,
        lineItems,
        returnUrl: adminAppUrl(shop, "/app/billing"),
        trialDays: 14,
        test: isTestCharge,
    };

    const res = await admin.graphql(mutation, { variables });
    const data = await res.json();
    console.log('[subscribe] create variables:', JSON.stringify(variables));
    console.log('[subscribe] create full response:', JSON.stringify(data));

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
    if (state === 'preview') return ' (Try it for free)';
    return '';
}

// Full Analytics is fully "enabled" (in the gating sense) on both Starter
// and Pro, but Starter's actual analytics page only surfaces Overview and
// Build a Combo data — Pro adds the rest. The generic state-based suffix
// above can't express that (both tiers share the same 'enabled' state), so
// this is a presentation-only override scoped to this one row on this one
// page — does not affect app/config/plans.js or the analytics page's own
// gating logic, which is intentionally left untouched.
function featureRowLabel(featureKey, planKey, state) {
    if (featureKey === 'full_analytics' && planKey === 'starter') {
        return 'Full Analytics — Overview & Build a Combo only';
    }
    return FEATURES[featureKey].label + featureLabelSuffix(state);
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

    const handleSelect = (planKey) => {
        if (planKey === currentPlanKey) return;
        // Only a real downgrade (an existing approved plan being replaced)
        // needs the "this cancels your subscription" warning — a shop with
        // no currentPlanKey yet is approving for the first time, not
        // downgrading from anything.
        if (planKey === 'free' && currentPlanKey) {
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
        if (!currentPlanKey) return { label: planKey === 'free' ? 'Get Started Free' : `Get ${PLANS[planKey].label} — 14-day trial`, variant: 'upgrade' };
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
                                        {isHighlightPlan ? 'Most Popular' : planKey === 'pro' ? 'Best Value' : 'Free To Start With'}
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
                                                        {featureRowLabel(featureKey, planKey, state)}
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
