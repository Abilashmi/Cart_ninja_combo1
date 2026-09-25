// Minimal @shopify/app-bridge-react stand-in: resourcePicker returns whatever
// the test put on window.__pickerResult.
export function useAppBridge() {
  return { resourcePicker: async () => window.__pickerResult || [] };
}
