import { useActionData, useLoaderData, useNavigation, useSubmit, useSearchParams, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import {
    Page, BlockStack, Text, Icon, Divider, Banner, Box, Modal, TextField,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon, TargetIcon, EyeCheckMarkIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getShopPlan, getShopBillingInterval, setPendingPlanKey } from "../services/plan-permissions.server";
import { getPromoTrialDays, redeemPromoCode } from "../services/promo.server";
import { PLANS, PLAN_KEYS, FEATURES, trialDaysFor, getOrderRange } from "../config/plans";

// Ordered feature rows shown on every plan card, pulled from the single
// FEATURES registry — adding/removing a feature there updates this page
// automatically, no copy to maintain here.
// combo_tier_pricing only keeps tiers working on older Classic combos; not a selling point.
const FEATURE_ROWS = Object.keys(FEATURES).filter((key) => key !== 'combo_tier_pricing');

// Trial length: 14 days, monthly or yearly; a redeemed promo code
// overrides it with whatever that code was configured with (trialDaysFor in
// app/config/plans.js).

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
    const [planKey, promoTrialDays, interval] = await Promise.all([
        getShopPlan(session.shop, admin),
        getPromoTrialDays(session.shop),
        getShopBillingInterval(session.shop),
    ]);
    // getShopPlan already defaults an unapproved shop to 'free', which is
    // exactly its real feature access now that /app.jsx no longer forces
    // approval before using the app — so that's shown as the current plan
    // here too, not treated as "no plan selected yet."
    return { currentPlanKey: planKey, currentInterval: planKey === 'free' ? 'monthly' : interval, promoTrialDays };
}

export async function action({ request }) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();

    // Promo-code redemption is a separate concern from plan selection below —
    // handled first and returns early so it never touches the
    // appSubscriptionCreate logic.
    if (formData.get("intent") === "redeem_promo") {
        const code = formData.get("code");
        const result = await redeemPromoCode(shop, code);
        return { promoResult: result };
    }

    const planKey = formData.get("planKey");
    // Free is always a monthly usage-only subscription.
    const interval = formData.get("interval") === "ANNUAL" && planKey !== "free" ? "ANNUAL" : "EVERY_30_DAYS";
    const isAnnual = interval === "ANNUAL";

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

    async function fetchActiveSubscriptions() {
        const subRes = await admin.graphql(`
            query {
                currentAppInstallation {
                    activeSubscriptions {
                        id
                        status
                        lineItems { plan { pricingDetails { __typename ... on AppRecurringPricing { interval } } } }
                    }
                }
            }
        `);
        const subData = await subRes.json();
        return subData.data?.currentAppInstallation?.activeSubscriptions || [];
    }

    async function fetchActiveSubscriptionIds() {
        // activeSubscriptions returns both ACTIVE and PENDING subscriptions
        // (that's what "active" means in Shopify's Billing API — cancelled/
        // declined/expired ones are already excluded) — a leftover PENDING
        // subscription from an earlier attempt that was never approved on
        // Shopify's confirmation page still counts toward the "same pricing
        // details" conflict, so every entry here needs cancelling, not just
        // ones with status === "ACTIVE".
        return (await fetchActiveSubscriptions()).map(s => s.id);
    }

    async function cancelActiveSubscription({ pendingOnly = false } = {}) {
        const subIds = pendingOnly
            ? (await fetchActiveSubscriptions()).filter((s) => String(s.status || '').toUpperCase() !== 'ACTIVE').map((s) => s.id)
            : await fetchActiveSubscriptionIds();

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
            const remaining = pendingOnly
                ? (await fetchActiveSubscriptions()).filter((s) => String(s.status || '').toUpperCase() !== 'ACTIVE')
                : await fetchActiveSubscriptionIds();
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
    // A yearly plan is never cancelled here: that would throw away the rest
    // of the year the merchant paid for. Shopify replaces it instead
    // (replacementBehavior STANDARD): a dearer yearly plan at once, prorated;
    // a cheaper yearly plan, monthly or Free when the paid year ends. A yearly
    // subscription has no usage line item, so there is no "same pricing
    // details" clash; only leftover unapproved (PENDING) ones are cancelled.
    let replacingAnnual = false;
    try {
        replacingAnnual = (await fetchActiveSubscriptions()).some((s) =>
            String(s.status || '').toUpperCase() === 'ACTIVE'
            && (s.lineItems || []).some((li) => li.plan?.pricingDetails?.interval === 'ANNUAL'));
        const cancelErr = await cancelActiveSubscription({ pendingOnly: replacingAnnual });
        if (cancelErr?.error) {
            return { error: cancelErr.error };
        }
    } catch (err) {
        return { error: err.message || "Failed to cancel existing subscription." };
    }
    const replacementArgs = replacingAnnual ? { replacementBehavior: "STANDARD" } : {};

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
                    $replacementBehavior: AppSubscriptionReplacementBehavior
                ) {
                    appSubscriptionCreate(
                        name: $name
                        lineItems: $lineItems
                        returnUrl: $returnUrl
                        test: $test
                        replacementBehavior: $replacementBehavior
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
                    ...replacementArgs,
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

    const price = isAnnual ? plan.price.annual : plan.price.monthly;

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

    // Shopify allows no usage charges on a yearly subscription: yearly plans
    // have no per-order / AI credit overage (storefront pauses at the order
    // cap, AI BRIX stops at its credits; orderCapBehavior in config/plans.js).
    if (!isAnnual) lineItems.push(usageLineItem);

    // Every merchant gets the standard trial by default: 14 days monthly, 60
    // days yearly. A redeemed promo code overrides it with whatever that code
    // was configured with (e.g. 30 days; on yearly only when longer) — see
    // app/services/promo.server.js. No new trial while replacing a yearly
    // plan the merchant is already paying for.
    const promoTrialDays = await getPromoTrialDays(shop);
    const trialDays = replacingAnnual ? 0 : trialDaysFor(promoTrialDays);

    const mutation = `
        mutation AppSubscriptionCreate(
            $name: String!
            $lineItems: [AppSubscriptionLineItemInput!]!
            $returnUrl: URL!
            $trialDays: Int
            $test: Boolean
            $replacementBehavior: AppSubscriptionReplacementBehavior
        ) {
            appSubscriptionCreate(
                name: $name
                lineItems: $lineItems
                returnUrl: $returnUrl
                trialDays: $trialDays
                test: $test
                replacementBehavior: $replacementBehavior
            ) {
                userErrors { field message }
                confirmationUrl
                appSubscription { id status }
            }
        }
    `;

    const variables = {
        name: `Cart Ninja ${plan.label}${isAnnual ? " (Yearly)" : ""}`,
        lineItems,
        returnUrl: adminAppUrl(shop, "/app/billing"),
        trialDays,
        test: isTestCharge,
        ...replacementArgs,
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
    await setPendingPlanKey(shop, planKey, isAnnual ? "annual" : "monthly");

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

function featureRowLabel(featureKey, planKey, state) {
    if (featureKey === 'build_a_combo' && state === 'enabled') {
        const limit = PLANS[planKey].comboTemplateLimit;
        return limit === null ? 'Build a Combo — unlimited templates' : `Build a Combo — up to ${limit} templates`;
    }
    return FEATURES[featureKey].label + featureLabelSuffix(state);
}

// The plan's monthly orders on its card: "51–200 orders / month", then what
// happens past the top of the range.
function ordersLine(planKey, yearly) {
    const p = PLANS[planKey];
    const { from, to } = getOrderRange(planKey);
    const range = from <= 1 ? `Up to ${to.toLocaleString('en-US')}` : `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')}`;
    if (p.orderCap === null) return `${range} orders / month`;
    if (p.overageRate > 0 && !yearly) return `${range} orders / month — then $${p.overageRate.toFixed(2)}/order`;
    return `${range} orders / month — storefront pauses after that`;
}

const CARD_BADGES = {
    free: 'Free To Start With',
    lite: 'Your First Sales',
    starter: 'Most Popular',
    growth: 'Growing Fast',
    pro: 'Best Value',
};

export default function SubscribePage() {
    const { currentPlanKey, currentInterval = 'monthly', promoTrialDays: initialPromoTrialDays } = useLoaderData();
    // Monthly or yearly prices on the cards (yearly = 10 × monthly, same
    // 14-day trial, no per-order / AI overage: see orderCapBehavior in config/plans.js).
    const [billing, setBilling] = useState(currentInterval === 'annual' ? 'annual' : 'monthly');
    const isYearly = billing === 'annual';
    const intervalParam = isYearly ? 'ANNUAL' : 'EVERY_30_DAYS';
    const actionData = useActionData();
    const navigation = useNavigation();
    const submit = useSubmit();
    const [searchParams] = useSearchParams();
    const highlight = searchParams.get('highlight');
    const isSubmitting = navigation.state === "submitting";
    const [downgradeConfirm, setDowngradeConfirm] = useState(false);

    const promoFetcher = useFetcher();
    const [promoCode, setPromoCode] = useState('');
    const [promoErrorMsg, setPromoErrorMsg] = useState(null);
    // 0 = not eligible; any positive number is the trial length a redeemed
    // code granted (see app/services/promo.server.js).
    const [promoTrialDays, setPromoTrialDays] = useState(initialPromoTrialDays);
    const [planModalPlanKey, setPlanModalPlanKey] = useState(null);
    const promoResult = promoFetcher.data?.promoResult;
    const isPromoSubmitting = promoFetcher.state === "submitting";
    const isPromoEligible = promoTrialDays > 0;
    // Every merchant gets a trial by default — a redeemed code only matters
    // when it changes the length from the standard one.
    const effectiveTrialDays = trialDaysFor(promoTrialDays);
    const standardTrialDays = trialDaysFor(0);

    // Fires once the promo redemption fetcher settles. On success the modal
    // stays open showing the acknowledgment (how many days were just
    // granted) — the merchant clicks "Continue" themselves to proceed,
    // rather than being redirected to Shopify's billing page the instant
    // the code validates.
    useEffect(() => {
        if (promoFetcher.state !== 'idle' || !promoResult) return;
        if (promoResult.success) {
            setPromoTrialDays(promoResult.trialDays || 0);
            setPromoErrorMsg(null);
        } else {
            setPromoErrorMsg(promoResult.error || 'Invalid or expired promo code.');
        }
    }, [promoFetcher.state, promoResult]);

    useEffect(() => {
        if (actionData?.confirmationUrl) {
            setDowngradeConfirm(false);
            window.top.location.href = actionData.confirmationUrl;
        }
    }, [actionData]);

    const isCurrentChoice = (planKey) => planKey === currentPlanKey && (planKey === 'free' || billing === currentInterval);

    const handleSelect = (planKey) => {
        if (isCurrentChoice(planKey)) return;
        // Only a real downgrade (an existing approved plan being replaced)
        // needs the "this cancels your subscription" warning — a shop with
        // no currentPlanKey yet is approving for the first time, not
        // downgrading from anything.
        if (planKey === 'free' && currentPlanKey) {
            setDowngradeConfirm(true);
            return;
        }
        if (planKey === 'free' || isPromoEligible) {
            // Free never carries a trial, and a shop that's already promo-
            // eligible has nothing to gain from the code prompt — skip
            // straight to plan submission in both cases.
            submit({ planKey, interval: intervalParam }, { method: "POST" });
            return;
        }
        setPromoCode('');
        setPromoErrorMsg(null);
        setPlanModalPlanKey(planKey);
    };

    const confirmDowngrade = () => {
        submit({ planKey: "free" }, { method: "POST" });
    };

    // Primary action for the plan-picker modal. Three states: a code was
    // just successfully applied (isPromoEligible) → proceed to plan
    // submission; a code is typed but not yet applied → redeem it and stay
    // open for the acknowledgment; field left blank → proceed without a
    // trial.
    const handleModalContinue = () => {
        const planKey = planModalPlanKey;
        if (!planKey) return;
        if (!isPromoEligible && promoCode.trim()) {
            promoFetcher.submit({ intent: "redeem_promo", code: promoCode }, { method: "POST" });
        } else {
            setPlanModalPlanKey(null);
            submit({ planKey, interval: intervalParam }, { method: "POST" });
        }
    };

    const getBtn = (planKey) => {
        const trialSuffix = ` — ${effectiveTrialDays}-day trial`;
        if (isCurrentChoice(planKey)) return { label: 'Current Plan', variant: 'current' };
        const rank = PLAN_KEYS.indexOf(planKey);
        const currentRank = PLAN_KEYS.indexOf(currentPlanKey);
        if (planKey === 'free') return { label: 'Downgrade to Free', variant: 'downgrade' };
        if (planKey === currentPlanKey) return { label: isYearly ? 'Switch to yearly billing' : 'Switch to monthly billing', variant: 'upgrade' };
        return { label: rank > currentRank ? `Upgrade to ${PLANS[planKey].label}${trialSuffix}` : `Switch to ${PLANS[planKey].label}`, variant: 'upgrade' };
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
                        <Text as="p" variant="bodyMd" tone="subdued">Every feature on every plan — pick the one that fits your monthly orders. No hidden fees.</Text>
                    </div>

                    {isPromoEligible && (
                        <div style={{ marginTop: 16 }}>
                            <Text as="p" variant="bodySm" tone="success" fontWeight="semibold">
                                Promo applied — you get {effectiveTrialDays} days free on any paid plan (instead of the standard {standardTrialDays}).
                            </Text>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div role="radiogroup" aria-label="Billing" style={{ display: 'inline-flex', gap: 4, padding: 4, background: '#f3f4f6', borderRadius: 999, border: '1px solid #e5e7eb' }}>
                        {[['monthly', 'Monthly'], ['annual', 'Yearly · 2 months free']].map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="radio"
                                aria-checked={billing === key}
                                onClick={() => setBilling(key)}
                                style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 18px', fontSize: 13, fontWeight: 700, background: billing === key ? '#1a1a1a' : 'transparent', color: billing === key ? '#fff' : '#374151' }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 20, alignItems: 'stretch' }}>
                    {PLAN_KEYS.map((planKey) => {
                        const p = PLANS[planKey];
                        const prevPlanKey = PLAN_KEYS[PLAN_KEYS.indexOf(planKey) - 1];
                        const isCurrent = isCurrentChoice(planKey);
                        const yearlyCard = isYearly && p.price.monthly > 0;
                        const isHighlightPlan = planKey === 'starter';
                        const btn = getBtn(planKey);
                        return (
                            <div key={planKey} style={{ background: '#fff', borderRadius: 16, border: `${isHighlightPlan ? '2px' : '1px'} solid ${isHighlightPlan ? '#1a9de0' : isCurrent ? '#1a1a1a' : '#e5e7eb'}`, boxShadow: isHighlightPlan ? '0 8px 32px rgba(26,157,224,0.14)' : isCurrent ? '0 4px 16px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

                                {isCurrent && (
                                    <div style={{ position: 'absolute', top: 12, right: 12, background: '#1a1a1a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999, letterSpacing: '0.3px' }}>ACTIVE</div>
                                )}

                                <div style={{ padding: '9px 22px', background: isHighlightPlan ? '#1a9de0' : '#f9fafb', borderBottom: `1px solid ${isHighlightPlan ? '#0e8bc8' : '#e5e7eb'}` }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: isHighlightPlan ? '#fff' : '#6b7280', letterSpacing: '0.3px' }}>
                                        {CARD_BADGES[planKey]}
                                    </span>
                                </div>

                                <div style={{ padding: '22px 22px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Text as="h2" variant="headingLg" fontWeight="bold">{p.label}</Text>
                                    <div style={{ marginTop: 2 }}><Text as="p" variant="bodyXs" tone="subdued">{p.tagline}</Text></div>

                                    <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                                        <span style={{ fontSize: 40, fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>${yearlyCard ? p.price.annual : p.price.monthly}</span>
                                        <span style={{ fontSize: 14, color: '#6b7280', marginBottom: 5 }}>{yearlyCard ? '/ year' : '/ month'}</span>
                                    </div>
                                    <Text as="p" variant="bodyXs" tone={isHighlightPlan || yearlyCard ? 'success' : 'subdued'}>
                                        {p.price.monthly === 0
                                            ? 'Always free'
                                            : yearlyCard
                                                ? `Billed yearly — $${(p.price.annual / 12).toFixed(2)}/month, 2 months free`
                                                : 'Billed monthly — cancel anytime'}
                                    </Text>

                                    <Divider />

                                    <div style={{ margin: '14px 0', display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', borderRadius: 8, padding: '9px 14px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}><Icon source={TargetIcon} tone="base" /></span>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                                            {ordersLine(planKey, yearlyCard)}
                                        </span>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 20 }}>
                                        <Text as="p" variant="bodyXs" fontWeight="bold" tone="subdued">
                                            {planKey === 'free' ? 'Every feature included:' : `Everything in ${PLANS[prevPlanKey].label}, plus:`}
                                        </Text>
                                        {FEATURE_ROWS.filter((featureKey) => {
                                            // Every card used to render every feature row regardless of plan,
                                            // so Starter/Pro repeated the exact same checkmarks Free already
                                            // showed. Now that each non-Free card is headed "Everything in X,
                                            // plus:", only show rows whose state actually changed from the
                                            // previous tier — a row with an identical state was already implied
                                            // by that heading.
                                            if (!prevPlanKey) return true;
                                            // Same 'enabled' state but a bigger template allowance is
                                            // still worth a row (Starter 3 → Growth 10 → Pro unlimited).
                                            if (featureKey === 'build_a_combo' && PLANS[planKey].comboTemplateLimit !== PLANS[prevPlanKey].comboTemplateLimit) return true;
                                            return FEATURES[featureKey].states[planKey] !== FEATURES[featureKey].states[prevPlanKey];
                                        }).map((featureKey) => {
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
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                            <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                <Icon source={CheckCircleIcon} tone="success" />
                                            </span>
                                            <Text as="p" variant="bodyXs">
                                                {yearlyCard
                                                    ? `AI BRIX — ${p.aiBrixCredits} credits / month`
                                                    : `AI BRIX — ${p.aiBrixCredits} credits / month, then $${p.aiBrixOverageRate.toFixed(2)}/credit`}
                                            </Text>
                                        </div>
                                        {(!prevPlanKey || PLANS[prevPlanKey].watermarkRemovable !== p.watermarkRemovable) && (
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                                <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                    <Icon source={p.watermarkRemovable ? CheckCircleIcon : XCircleIcon} tone={p.watermarkRemovable ? 'success' : 'critical'} />
                                                </span>
                                                <Text as="p" variant="bodyXs" tone={p.watermarkRemovable ? undefined : 'subdued'}>
                                                    {p.watermarkRemovable ? 'Remove "Powered by BRIX" watermark' : '"Powered by BRIX" watermark (always on)'}
                                                </Text>
                                            </div>
                                        )}
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
                    <Text as="p" variant="bodyXs" tone="subdued">
                        {isYearly
                            ? `Yearly plans include a ${effectiveTrialDays}-day free trial, then one payment a year. Shopify can't add per-order or AI charges to a yearly plan, so past the monthly order limit your storefront widgets pause until next month, and AI BRIX stops at the monthly credits. Leaving a yearly plan takes effect when the paid year ends.`
                            : `All paid plans include a ${effectiveTrialDays}-day free trial. Cancel anytime. No charge until trial ends.`}
                    </Text>
                </div>

                <div style={{ height: 72 }} />
            </div>

            {planModalPlanKey && (
                <Modal
                    open
                    onClose={() => setPlanModalPlanKey(null)}
                    title="Great choice!"
                    primaryAction={{
                        content: isPromoSubmitting ? 'Applying…' : (isPromoEligible || !promoCode.trim() ? 'Continue' : 'Apply Code & Continue'),
                        onAction: handleModalContinue,
                        loading: isPromoSubmitting,
                    }}
                    secondaryActions={[{ content: 'Cancel', onAction: () => setPlanModalPlanKey(null) }]}
                >
                    <Modal.Section>
                        <BlockStack gap="300">
                            {isPromoEligible ? (
                                <Text as="p" fontWeight="semibold" tone="success">
                                    You get {effectiveTrialDays} days free on {PLANS[planModalPlanKey].label} (instead of the standard {standardTrialDays}).
                                </Text>
                            ) : (
                                <>
                                    <Text as="p">
                                        You are getting {PLANS[planModalPlanKey].label}{isYearly ? ' (billed yearly)' : ''}, which includes a {standardTrialDays}-day free trial. Have a promo code for an extended trial?
                                    </Text>
                                    <TextField
                                        label="Promo code"
                                        labelHidden
                                        value={promoCode}
                                        onChange={(value) => { setPromoCode(value); setPromoErrorMsg(null); }}
                                        placeholder="Enter promo code (optional)"
                                        autoComplete="off"
                                        disabled={isPromoSubmitting}
                                    />
                                    {promoErrorMsg && (
                                        <Text as="p" tone="critical">{promoErrorMsg}</Text>
                                    )}
                                </>
                            )}
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}

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
                            {currentInterval === 'annual' && (
                                <Text as="p" fontWeight="semibold">
                                    You keep your yearly plan until the year you paid for ends; Free starts then.
                                </Text>
                            )}
                            <Text as="p">
                                Downgrading cancels your current subscription. Free keeps every feature for up to{' '}
                                {PLANS.free.orderCap} orders a month; past that your storefront widgets pause until next
                                month, and the {'"Powered by BRIX"'} watermark shows. Your saved designs are kept — nothing
                                is deleted.
                            </Text>
                        </BlockStack>
                    </Modal.Section>
                </Modal>
            )}
        </Page>
    );
}
