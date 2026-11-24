// Names, short descriptions and icons of the guided-setup features (admin texts
// in en.json), shared by the panel and the Home cards. `to` = where the Home
// card's Customize button goes (the first step of each tour points at it).
import {
  CashDollarIcon, CartIcon, RewardIcon, CollectionIcon, ProductIcon, DiscountCodeIcon, DiscountIcon, ChatIcon,
} from '@shopify/polaris-icons';

// `embed` = the app embed (config/theme-extension.js APP_EMBEDS) the feature
// needs on the storefront; the panel warns while it's off. COD and combo pages
// are loaded by "BRIX Cart & Combo".
export const GUIDE_MODULE_META = {
  cod: { name: 'admin.guide.mod_cod', desc: 'admin.guide.mod_cod_desc', icon: CashDollarIcon, to: '/app/cod/customize', tint: '#fef3c7', accent: '#d97706', embed: 'cart_drawer' },
  cart: { name: 'admin.guide.mod_cart', desc: 'admin.guide.mod_cart_desc', icon: CartIcon, to: '/app/cartdrawer', tint: '#e0f2fe', accent: '#0284c7', embed: 'cart_drawer' },
  fbt: { name: 'admin.guide.mod_fbt', desc: 'admin.guide.mod_fbt_desc', icon: RewardIcon, to: '/app/fbt', tint: '#fce7f3', accent: '#db2777', embed: 'Fbt' },
  combo: { name: 'admin.guide.mod_combo', desc: 'admin.guide.mod_combo_desc', icon: CollectionIcon, to: '/app/bundles', tint: '#dcfce7', accent: '#16a34a', embed: 'cart_drawer' },
  packs: { name: 'admin.guide.mod_packs', desc: 'admin.guide.mod_packs_desc', icon: ProductIcon, to: '/app/packs', tint: '#ede9fe', accent: '#7c3aed', embed: 'Packs' },
  coupon: { name: 'admin.guide.mod_coupon', desc: 'admin.guide.mod_coupon_desc', icon: DiscountCodeIcon, to: '/app/productwidget', tint: '#ffedd5', accent: '#ea580c', embed: 'coupon_slider' },
  discounts: { name: 'admin.guide.mod_discounts', desc: 'admin.guide.mod_discounts_desc', icon: DiscountIcon, to: '/app/coupons', tint: '#f1f5f9', accent: '#475569' },
  brix_ai: { name: 'admin.guide.mod_brix_ai', desc: 'admin.guide.mod_brix_ai_desc', icon: ChatIcon, to: '/app/brix-ai', tint: '#e0f2fe', accent: '#1a9de0' },
};

// The tour's first step points here (config/guide-tours.js `open`).
export const homeCustomizeTarget = (moduleId) => `home-mod-${moduleId}-customize`;
