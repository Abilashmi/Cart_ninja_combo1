import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { authenticate } from "../shopify.server";
import { getShopCurrencySymbol } from "../utils/currency.server";
import { CurrencyProvider } from "../components/CurrencyContext";
import { PlanProvider } from "../components/PlanContext";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

    const subRes = await admin.graphql(`
        query {
            currentAppInstallation {
                activeSubscriptions { id status }
            }
        }
    `);
    const subData = await subRes.json();
    const subs = subData.data?.currentAppInstallation?.activeSubscriptions || [];
    const isPro = subs.some(s => s.status === "ACTIVE");

    const currencySymbol = await getShopCurrencySymbol(admin);
    // eslint-disable-next-line no-undef
    return { apiKey: process.env.SHOPIFY_API_KEY || "", currencySymbol, isPro };
};

export default function App() {
    const { apiKey, currencySymbol, isPro } = useLoaderData();

    return (
        <ShopifyAppProvider embedded apiKey={apiKey}>
            <PolarisAppProvider i18n={enTranslations}>
                <CurrencyProvider symbol={currencySymbol}>
                    <PlanProvider isPro={isPro}>
                        <s-app-nav>
                            <s-link href="/app">Home</s-link>
                            <s-link href="/app/analytics">Analytics</s-link>
                            <s-link href="/app/cartdrawer">Cart Editor</s-link>
                            <s-link href="/app/fbt">Frequently Bought Together</s-link>
                            <s-link href="/app/productwidget">Coupon Banner</s-link>
                            <s-link href="/app/coupons">Coupon Creator</s-link>
                            <s-link href="/app/bundles">Combo Forge</s-link>
                            <s-link href="/app/subscribe">Plans</s-link>
                            <s-link href="/app/additional">Account</s-link>
                        </s-app-nav>
                        <Outlet context={{ currencySymbol }} />
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
