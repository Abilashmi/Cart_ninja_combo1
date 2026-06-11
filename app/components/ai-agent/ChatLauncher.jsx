import { Icon } from "@shopify/polaris";
import { ChatIcon } from "@shopify/polaris-icons";

export default function ChatLauncher({ onClick, showPulse }) {
  return (
    <button
      className={`ai-launcher${showPulse ? " ai-pulse" : ""}`}
      onClick={onClick}
      aria-label="Open AI chat"
    >
      <Icon source={ChatIcon} tone="base" />
    </button>
  );
}
