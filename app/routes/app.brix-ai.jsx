import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import BrixAiPage from "../components/ai-agent/BrixAiPage";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function BrixAiRoute() {
  return <BrixAiPage />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
