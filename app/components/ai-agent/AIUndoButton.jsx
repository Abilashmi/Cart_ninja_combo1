import { Button } from "@shopify/polaris";
import { UndoIcon } from "@shopify/polaris-icons";

export default function AIUndoButton({ action, onUndo, label }) {
  return (
    <Button
      size="slim"
      variant="tertiary"
      icon={UndoIcon}
      onClick={() => onUndo(action)}
    >
      {label || "Undo"}
    </Button>
  );
}
