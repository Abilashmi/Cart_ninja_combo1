import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";
import { getCurrentSettingsSnapshot } from "../services/ai-agent-actions.server";
import { listAiAgentHistory } from "../services/ai-agent-history.server";
import AiAgentWorkspace from "../components/ai-agent/AiAgentWorkspace";

export const loader = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const themeColors = await analyzeThemeColors(admin);
    const [currentSettings, history] = await Promise.all([
        getCurrentSettingsSnapshot(shop, themeColors),
        listAiAgentHistory(shop),
    ]);

    return { shop, themeColors, currentSettings, history };
};

export default function AiAgentRoute() {
    return <AiAgentWorkspace />;
}

export function ErrorBoundary() {
    return boundary.error(useRouteError());
}
