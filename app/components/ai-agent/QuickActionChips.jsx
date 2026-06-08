import { InlineStack, Button } from "@shopify/polaris";
import { MagicIcon } from "@shopify/polaris-icons";
import { QUICK_ACTIONS } from "./constants";

export default function QuickActionChips({ onSelect, disabled }) {
    return (
        <InlineStack gap="200" wrap>
            {QUICK_ACTIONS.map((item) => (
                <Button
                    key={item.label}
                    icon={MagicIcon}
                    disabled={disabled}
                    onClick={() => onSelect(item.prompt)}
                >
                    {item.label}
                </Button>
            ))}
        </InlineStack>
    );
}
