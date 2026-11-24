// Identity of this app's theme app extension, for deep links into the theme
// editor. Same uid as extensions/cart-drawer/shopify.extension.toml and the
// Setup Guide page (app/routes/app.setup.jsx).
export const EXTENSION_UUID = 'c57aa0a4-9f48-795d-3a28-d57b2bbe1419dcaa27cf';

// The "BRIX Cart & Combo" app embed (extensions/cart-drawer/blocks/cart_drawer.liquid).
// It mounts the cart drawer AND loads combo-page.js, which is what renders
// published Build a Combo pages — so combo pages need it switched on.
export const CART_DRAWER_EMBED_HANDLE = 'cart_drawer';
export const CART_DRAWER_EMBED_NAME = 'BRIX Cart & Combo';

// Opens the merchant's theme editor on the App embeds panel with this embed
// pre-selected for activation.
export function cartDrawerEmbedEditorUrl(shop) {
  return appEmbedEditorUrl(shop, CART_DRAWER_EMBED_HANDLE);
}

// Every app embed of the extension (blocks/<handle>.liquid with target "body"),
// by handle, with the name the theme editor shows. The guided setup asks for
// the one its feature needs.
export const APP_EMBEDS = {
  cart_drawer: CART_DRAWER_EMBED_NAME,
  Fbt: 'BRIX FBT',
  coupon_slider: 'BRIX Coupon',
  Packs: 'BRIX Packs',
};

export function appEmbedEditorUrl(shop, handle) {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${EXTENSION_UUID}/${handle}`;
}
