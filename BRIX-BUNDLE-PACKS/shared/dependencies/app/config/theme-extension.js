// Identity of this app's theme app extension, for deep links into the theme
// editor. Same uid as extensions/cart-drawer/shopify.extension.toml and the
// Setup Guide page (app/routes/app.setup.jsx).
export const EXTENSION_UUID = 'c57aa0a4-9f48-795d-3a28-d57b2bbe1419dcaa27cf';

// The "Custom Cart Drawer" app embed (extensions/cart-drawer/blocks/cart_drawer.liquid).
// It mounts the cart drawer AND loads combo-page.js, which is what renders
// published Build a Combo pages — so combo pages need it switched on.
export const CART_DRAWER_EMBED_HANDLE = 'cart_drawer';
export const CART_DRAWER_EMBED_NAME = 'Custom Cart Drawer';

// Opens the merchant's theme editor on the App embeds panel with this embed
// pre-selected for activation.
export function cartDrawerEmbedEditorUrl(shop) {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${EXTENSION_UUID}/${CART_DRAWER_EMBED_HANDLE}`;
}
