import { Outlet, useLoaderData, useRouteError, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import { getShopCurrency } from "../utils/currency.server";
import { CurrencyProvider } from "../components/CurrencyContext";
import { PlanProvider } from "../components/PlanContext";
import { getShopPlan } from "../services/plan-permissions.server";
import { getFeatureState } from "../config/plans";

// Merchants are no longer forced through /app/subscribe before using the
// app — they land straight in after install and can pick/switch a plan
// whenever they want. A shop with no approved subscription yet is treated
// as Free by getShopPlan's own default, which already matches Free's real
// feature set, so nothing else needs to special-case the unsubscribed state.
export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const [planKey, currency] = await Promise.all([
        getShopPlan(session.shop, admin),
        getShopCurrency(admin, session.shop),
    ]);

    return {
        // eslint-disable-next-line no-undef
        apiKey: process.env.SHOPIFY_API_KEY || "",
        currencySymbol: currency.symbol,
        currencyCode: currency.code,
        currencyLocale: currency.locale,
        planKey,
        shop: session.shop,
    };
};

// s-app-nav / s-link are Shopify App Bridge native web components. Plain
// text content always renders; nested React icon components (e.g.
// @shopify/polaris-icons SVGs) do not, and s-badge doesn't pick up Polaris
// styling when nested this deep inside s-link either (renders unstyled).
// A plain <span> with inline styles sidesteps both — it's just DOM/CSS, no
// custom element upgrade required — so it reliably renders as a solid
// black "Pro" pill regardless of the App Bridge nav's slotting behavior.
function navBadge(featureKey, planKey) {
    if (!featureKey || getFeatureState(planKey, featureKey) !== 'locked') return null;
    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000',
            color: '#ffffff',
            borderRadius: 999,
            padding: '1px 8px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.3px',
            marginLeft: 4,
            verticalAlign: 'middle',
        }}>Pro</span>
    );
}

export default function App() {
    const { apiKey, currencySymbol, currencyCode, currencyLocale, planKey, shop } = useLoaderData();
    const navigation = useNavigation();
    const isNavigating = navigation.state !== "idle";

    return (
        <ShopifyAppProvider embedded apiKey={apiKey}>
            <PolarisAppProvider i18n={enTranslations}>
                <CurrencyProvider symbol={currencySymbol} code={currencyCode} locale={currencyLocale}>
                    <PlanProvider plan={planKey}>
                        {isNavigating && <div className="route-progress-bar" />}
                        <s-app-nav>
                            <s-link href="/app">Home</s-link>
                            <s-link href="/app/brix-ai">Brix AI</s-link>
                            <s-link href="/app/cartdrawer">Cart Editor</s-link>
                            <s-link href="/app/bundles">Build a Combo {navBadge('build_a_combo', planKey)}</s-link>
                            <s-link href="/app/fbt">Frequently Bought Together</s-link>
                            <s-link href="/app/productwidget">Coupon Banner</s-link>
                            <s-link href="/app/coupons">Discount Creator</s-link>
                            <s-link href="/app/subscribe">Plans</s-link>
                            <s-link href="/app/billing">Billing</s-link>
                            <s-link href="/app/analytics">Analytics</s-link>
                            <s-link href="/app/additional">Account</s-link>
                        </s-app-nav>
                        <Outlet context={{ currencySymbol, currencyCode, shop }} />
                    </PlanProvider>
                </CurrencyProvider>
            </PolarisAppProvider>
        </ShopifyAppProvider>
    );
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
    return boundary.headers(headersArgs);
};

// This is the shared layout loader for every /app/* page — it re-runs on
// every child navigation by default, which meant a fresh Admin GraphQL call
// (currency) and shop/session lookup on every single in-app nav click. Plan
// key and currency effectively never change mid-session, so skip re-running
// this loader for plain GET navigations between child routes; it still runs
// after form submissions and always runs on a hard reload.
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }) {
    if (formMethod) return defaultShouldRevalidate;
    return false;
}
