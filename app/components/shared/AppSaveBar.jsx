import { useEffect, useState } from 'react';
import { SaveBar } from '@shopify/app-bridge-react';

// Shopify's contextual save bar for an editor page (Built for Shopify 4.1.5):
// shown at the top of the admin while `open` (the page has unsaved changes),
// with Save / Discard, and App Bridge asks the merchant to save or discard
// before leaving. The page's own Save / Discard buttons keep working.
// Rendered only once App Bridge is loaded (the `ui-save-bar` element needs
// it; the browser-check harnesses run pages without it).
export default function AppSaveBar({ id, open, onSave, onDiscard, saving = false }) {
  const [hasAppBridge, setHasAppBridge] = useState(false);
  useEffect(() => {
    setHasAppBridge(typeof window !== 'undefined' && Boolean(window.shopify?.saveBar));
  }, []);
  if (!hasAppBridge) return null;
  return (
    <SaveBar id={id} open={Boolean(open)}>
      <button variant="primary" onClick={onSave} loading={saving ? '' : undefined} disabled={saving}>Save</button>
      <button onClick={onDiscard} disabled={saving}>Discard</button>
    </SaveBar>
  );
}
