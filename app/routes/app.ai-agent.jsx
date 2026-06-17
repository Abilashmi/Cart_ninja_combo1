import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    return { shop: session.shop };
};

export default function AiAgentRoute() {
    return null;
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}
