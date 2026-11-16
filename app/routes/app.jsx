import { Outlet, useLoaderData, useRouteError, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import esTranslations from "@shopify/polaris/locales/es.json";
import { authenticate } from "../shopify.server";
import { getShopCurrency } from "../utils/currency.server";
import { CurrencyProvider } from "../components/CurrencyContext";
import { PlanProvider } from "../components/PlanContext";
import { getShopPlan } from "../services/plan-permissions.server";
import { getFeatureState } from "../config/plans";
import { adminMessages, getAdminLanguage, resolveAdminLocale, shopifyLocaleFor } from "../i18n/admin.server";
import { I18nProvider, useT } from "../i18n/admin";
import SupportChat from "../components/support/SupportChat";

// Polaris's own texts (date pickers, pagination, …) where Polaris has the language.
const POLARIS_TEXTS = { en: enTranslations, es: esTranslations };

// Merchants are no longer forced through /app/subscribe before using the
// app — they land straight in after install and can pick/switch a plan
// whenever they want. A shop with no approved subscription yet is treated
// as Free by getShopPlan's own default, which already matches Free's real
// feature set, so nothing else needs to special-case the unsubscribed state.
export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const [planKey, currency, savedLanguage] = await Promise.all([
        getShopPlan(session.shop, admin),
        getShopCurrency(admin, session.shop),
        getAdminLanguage(admin),
    ]);
    // Account → Language, else the language Shopify's admin is in (`locale` on the app's URL).
    const locale = resolveAdminLocale({ saved: savedLanguage, shopifyLocale: shopifyLocaleFor(session.shop, request) });

    return {
        // eslint-disable-next-line no-undef
        apiKey: process.env.SHOPIFY_API_KEY || "",
        currencySymbol: currency.symbol,
        currencyCode: currency.code,
        currencyLocale: currency.locale,
        planKey,
        shop: session.shop,
        i18n: { locale, messages: adminMessages(locale) },
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

// The app's navigation, in the admin's language.
function AppNav({ planKey }) { // eslint-disable-line react/prop-types
    const t = useT();
    return (
        <s-app-nav>
            <s-link href="/app">{t("admin.nav.home")}</s-link>
            <s-link href="/app/brix-ai">{t("admin.nav.brix_ai")}</s-link>
            {/* Every store sees COD Checkout; it stays off on the storefront
                until the merchant turns it on (DEFAULT_COD_SETTINGS.enabled). */}
            <s-link href="/app/cod">{t("admin.nav.cod")}</s-link>
            <s-link href="/app/cartdrawer">{t("admin.nav.cart_editor")}</s-link>
            <s-link href="/app/bundles">{t("admin.nav.build_combo")} {navBadge('build_a_combo', planKey)}</s-link>
            <s-link href="/app/packs">{t("admin.nav.packs")}</s-link>
            <s-link href="/app/fbt">{t("admin.nav.fbt")}</s-link>
            <s-link href="/app/productwidget">{t("admin.nav.coupon_banner")}</s-link>
            <s-link href="/app/coupons">{t("admin.nav.discount_creator")}</s-link>
            <s-link href="/app/subscribe">{t("admin.nav.plans")}</s-link>
            <s-link href="/app/billing">{t("admin.nav.billing")}</s-link>
            <s-link href="/app/analytics">{t("admin.nav.analytics")}</s-link>
            <s-link href="/app/additional">{t("admin.nav.account")}</s-link>
        </s-app-nav>
    );
}

export default function App() {
    const { apiKey, currencySymbol, currencyCode, currencyLocale, planKey, shop, i18n } = useLoaderData();
    const navigation = useNavigation();
    const isNavigating = navigation.state !== "idle";

    return (
        <ShopifyAppProvider embedded apiKey={apiKey}>
            <PolarisAppProvider i18n={POLARIS_TEXTS[i18n.locale] || enTranslations}>
                <I18nProvider locale={i18n.locale} messages={i18n.messages}>
                <CurrencyProvider symbol={currencySymbol} code={currencyCode} locale={currencyLocale}>
                    <PlanProvider plan={planKey}>
                        {isNavigating && (
                            // Page-loading indicator: a round spinner in the centre of the screen.
                            <div className="route-loader" role="progressbar" aria-label={i18n.messages["admin.common.loading"] || "Loading"}>
                                <span className="route-loader-ring" />
                            </div>
                        )}
                        <AppNav planKey={planKey} />
                        <Outlet context={{ currencySymbol, currencyCode, shop }} />
                        {/* "Need help setting up?" chat, BRIX AI first then the team (/internal/chat) */}
                        <SupportChat />
                    </PlanProvider>
                </CurrencyProvider>
                </I18nProvider>
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
