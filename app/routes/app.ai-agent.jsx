import { useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import AiAgent from "../components/ai-agent/AiAgent";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    return { shop: session.shop };
};

export default function AiAgentRoute() {
    const [params] = useSearchParams();
    const initialQuery = params.get("q") || "";
    return <AiAgent appName="Cart Ninja AI" initialQuery={initialQuery} />;
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}
