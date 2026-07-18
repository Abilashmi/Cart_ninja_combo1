import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState } from "react";
import { Form, useActionData, useLoaderData, redirect } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

// Shopify's Billing API returnUrl redirect (after a merchant approves a
// subscription charge) is a bare top-level navigation with no shop/host
// params — the SDK's own authenticate.admin() strips any query string when
// it bounces here (see validate-shop-and-host-params.js's bare
// redirect(loginPath)), so the shop can't be read from the URL at all in
// that case. The browser's Referer header still carries it though, since
// the previous page was https://admin.shopify.com/store/{shop}/... or
// Shopify's own charge-confirmation page — recovering it from there lets
// this route skip straight back into OAuth instead of stranding the
// merchant on a bare login form right after they just paid.
function shopFromReferer(request) {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const refUrl = new URL(referer);
    if (refUrl.hostname !== "admin.shopify.com") return null;
    const match = refUrl.pathname.match(/^\/store\/([a-zA-Z0-9-]+)/);
    return match ? `${match[1]}.myshopify.com` : null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || shopFromReferer(request);

  // If the shop is already known (e.g. session expired while embedded, or
  // recovered from Referer after a billing approval), skip the login form
  // and go straight to OAuth.
  if (shop) {
    throw redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  }

  const errors = loginErrorMessage(await login(request));
  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <s-page>
        <Form method="post">
          <s-section heading="Log in">
            <s-text-field
              name="shop"
              label="Shop domain"
              details="example.myshopify.com"
              value={shop}
              onChange={(e) => setShop(e.currentTarget.value)}
              autocomplete="on"
              error={errors.shop}
            ></s-text-field>
            <s-button type="submit">Log in</s-button>
          </s-section>
        </Form>
      </s-page>
    </AppProvider>
  );
}
