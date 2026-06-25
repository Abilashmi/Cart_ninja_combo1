import { redirect, useActionData, useNavigation, useSubmit } from "react-router";
import { useEffect, useState } from "react";
import {
    Page, BlockStack, InlineStack, Text, Icon, Divider, Banner, Box,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon, TargetIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
    const { admin } = await authenticate.admin(request);
    const res = await admin.graphql(`
        query {
            currentAppInstallation {
                activeSubscriptions { id status }
            }
        }
    `);
    const data = await res.json();
    const subs = data.data?.currentAppInstallation?.activeSubscriptions || [];
    // Already on Pro — go to billing dashboard
    if (subs.some(s => s.status === "ACTIVE")) {
        throw redirect("/app/billing");
    }
    return {};
}

export async function action({ request }) {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const interval = formData.get("interval") === "ANNUAL" ? "ANNUAL" : "EVERY_30_DAYS";
    const price = interval === "ANNUAL" ? "290.00" : "29.00";

    const mutation = `
        mutation AppSubscriptionCreate(
            $name: String!
            $lineItems: [AppSubscriptionLineItemInput!]!
            $returnUrl: URL!
            $trialDays: Int
        ) {
            appSubscriptionCreate(
                name: $name
                lineItems: $lineItems
                returnUrl: $returnUrl
                trialDays: $trialDays
            ) {
                userErrors { field message }
                confirmationUrl
                appSubscription { id status }
            }
        }
    `;

    const variables = {
        name: "Cart Ninja Pro",
        lineItems: [
            {
                plan: {
                    appRecurringPricingDetails: {
                        price: { amount: price, currencyCode: "USD" },
                        interval,
                    },
                },
            },
            {
                plan: {
                    appUsagePricingDetails: {
                        terms: "$0.10 per order above 50 orders/day. Capped at $500/month.",
                        cappedAmount: { amount: "500.00", currencyCode: "USD" },
                    },
                },
            },
        ],
        returnUrl: "https://c6c6-2409-40f4-208e-58d6-b4bc-8653-1ae-d600.ngrok-free.app/app/billing",
        trialDays: 14,
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

    return { confirmationUrl };
}

const PRO_FEATURES = [
    "Cart drawer customization",
    "Coupon slider",
    "Product recommendations (FBT, Grid, Carousel)",
    "Free shipping progress bar",
    "Star ratings on cart items",
    "Advanced analytics dashboard",
    "50 orders/day included",
    "Overage: $0.10/order above 50/day (max $500/mo)",
    "Priority support",
];

const PLANS = [
  {
    key: 'starter', badge: 'free forever', name: 'Starter', tagline: 'Launch & learn',
    price: '$0', period: '/ month', note: 'Always free', orderCap: 'Up to 50 orders / month',
    highlight: false, billingInterval: null,
    features: [
      { label: 'Slide-out cart drawer',                      ok: true  },
      { label: 'Auto-open on add to cart',                   ok: true  },
      { label: 'Custom header + announcement banner',        ok: true  },
      { label: 'Design controls (width, animation, shadow)', ok: true  },
      { label: 'Checkout button styling',                    ok: true  },
      { label: 'Coupon creator',                             ok: true  },
      { label: 'Basic analytics (revenue, AOV, clicks)',     ok: true  },
      { label: 'AI upsells',                                 ok: false },
      { label: 'Build a combo',                              ok: false },
      { label: 'Full analytics',                             ok: false },
    ],
  },
  {
    key: 'plus', badge: 'most popular', name: 'Plus', tagline: 'Grow your AOV',
    price: '$29', period: '/ month', note: 'Billed monthly — cancel anytime', orderCap: 'Up to 500 orders / month',
    highlight: true, billingInterval: 'EVERY_30_DAYS',
    features: [
      { label: 'Everything in Starter',                         ok: true },
      { label: 'Free-shipping progress bar + confetti',         ok: true },
      { label: 'In-cart coupon countdown timers',               ok: true },
      { label: 'AI in-cart upsells',                            ok: true },
      { label: 'Frequently bought together',                    ok: true },
      { label: 'Coupon banner (product / collection targeting)', ok: true },
      { label: 'Build a combo — 3 layouts + AI content',        ok: true },
      { label: 'Full analytics dashboard + funnels',            ok: true },
      { label: 'Mobile swipe-to-checkout',                      ok: true },
      { label: 'Priority email support',                        ok: true },
    ],
  },
  {
    key: 'pro', badge: 'best value', name: 'Pro', tagline: 'High-volume brands',
    price: '$79', period: '/ month', note: 'Billed monthly — cancel anytime', orderCap: 'Unlimited orders / month',
    highlight: false, billingInterval: 'EVERY_30_DAYS',
    features: [
      { label: 'Everything in Plus',              ok: true },
      { label: 'Unlimited combo templates',       ok: true },
      { label: 'Custom bundle layout builder',    ok: true },
      { label: 'Unlimited AI content generation', ok: true },
      { label: 'Multi-store support',             ok: true },
      { label: 'Dedicated onboarding call',       ok: true },
      { label: 'Slack / direct support channel',  ok: true },
      { label: 'Early access to new features',    ok: true },
      { label: 'Custom branding removal',         ok: true },
      { label: 'Revenue attribution reporting',   ok: true },
    ],
  },
];

export default function SubscribePage() {
    const actionData = useActionData();
    const navigation = useNavigation();
    const submit = useSubmit();
    const isSubmitting = navigation.state === "submitting";

    useEffect(() => {
        if (actionData?.confirmationUrl) {
            window.top.location.href = actionData.confirmationUrl;
        }
    }, [actionData]);

    const handleUpgrade = (billingInterval) => {
        if (!billingInterval) return;
        submit({ interval: billingInterval }, { method: "POST" });
    };

    // Loader redirects Pro users to /app/billing, so current plan is always 'starter' here
    const getBtn = (p) => {
        if (!p.billingInterval) return { label: 'Current Plan', variant: 'current' };
        return { label: 'Start for free — 14-day trial', variant: 'upgrade' };
    };

    const btnStyle = (variant, highlight) => {
        if (variant === 'current') return { background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb', cursor: 'default' };
        return { background: highlight ? '#fff' : '#1a1a1a', color: highlight ? '#1a1a1a' : '#fff', border: 'none', cursor: 'pointer' };
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
                    {PLANS.map((p) => {
                        const btn = getBtn(p);
                        const isCurrent = !p.billingInterval;
                        return (
                            <div key={p.key} style={{ background: '#fff', borderRadius: 16, border: `${p.highlight ? '2px' : '1px'} solid ${p.highlight ? '#1a9de0' : isCurrent ? '#1a1a1a' : '#e5e7eb'}`, boxShadow: p.highlight ? '0 8px 32px rgba(26,157,224,0.14)' : isCurrent ? '0 4px 16px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>

                                {/* Current plan ribbon */}
                                {isCurrent && (
                                    <div style={{ position: 'absolute', top: 12, right: 12, background: '#1a1a1a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999, letterSpacing: '0.3px' }}>ACTIVE</div>
                                )}

                                {/* Badge bar */}
                                <div style={{ padding: '9px 22px', background: p.highlight ? '#1a9de0' : '#f9fafb', borderBottom: `1px solid ${p.highlight ? '#0e8bc8' : '#e5e7eb'}` }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, color: p.highlight ? '#fff' : '#6b7280', letterSpacing: '0.3px' }}>{p.badge}</span>
                                </div>

                                <div style={{ padding: '22px 22px 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <Text as="h2" variant="headingLg" fontWeight="bold">{p.name}</Text>
                                    <div style={{ marginTop: 2 }}><Text as="p" variant="bodyXs" tone="subdued">{p.tagline}</Text></div>

                                    <div style={{ margin: '16px 0 4px', display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                                        <span style={{ fontSize: 40, fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{p.price}</span>
                                        <span style={{ fontSize: 14, color: '#6b7280', marginBottom: 5 }}>{p.period}</span>
                                    </div>
                                    <Text as="p" variant="bodyXs" tone={p.highlight ? 'success' : 'subdued'}>{p.note}</Text>

                                    <Divider />

                                    {/* Order cap pill */}
                                    <div style={{ margin: '14px 0', display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', borderRadius: 8, padding: '9px 14px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}><Icon source={TargetIcon} tone="base" /></span>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{p.orderCap}</span>
                                    </div>

                                    {/* Feature list */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 20 }}>
                                        {p.features.map((f) => (
                                            <div key={f.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                                <span style={{ display: 'flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                                                    <Icon source={f.ok ? CheckCircleIcon : XCircleIcon} tone={f.ok ? 'success' : 'critical'} />
                                                </span>
                                                <Text as="p" variant="bodyXs" tone={f.ok ? undefined : 'subdued'}>{f.label}</Text>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* CTA */}
                                <div style={{ padding: '0 22px 22px' }}>
                                    <button
                                        onClick={() => handleUpgrade(p.billingInterval)}
                                        disabled={btn.variant === 'current' || isSubmitting}
                                        style={{ width: '100%', padding: '12px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, transition: 'opacity 0.15s', ...btnStyle(btn.variant, p.highlight) }}
                                        onMouseOver={e => { if (btn.variant !== 'current') e.currentTarget.style.opacity = '0.85'; }}
                                        onMouseOut={e => { e.currentTarget.style.opacity = '1'; }}
                                    >
                                        {isSubmitting && btn.variant !== 'current' ? 'Starting trial…' : btn.label}
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
        </Page>
    );
}
