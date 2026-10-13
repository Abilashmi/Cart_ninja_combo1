// FBT widget colours beyond the six base ones (bg, text, price, button,
// button text, border): heading, product title, button hover, the Classic
// "Added" (selected) state, the selection indicator, and the Add-all button's
// loading / success states. Stored in the active template's JSON
// (fbt_widget.tempN), which the storefront reads as-is.
//
// '' = follow a base colour (see fbtEffectiveColors), so widgets saved before
// these existed look exactly the same. The storefront (snippets/
// fbt-widget-render.liquid normalizeConfig) mirrors these rules.
import { normalizeHex } from './color.shared.js';

export const FBT_EXTRA_COLOR_KEYS = [
  'headingColor', 'titleColor', 'buttonHoverColor',
  'selectedBgColor', 'selectedTextColor', 'checkboxColor',
  'loadingBgColor', 'successBgColor', 'successTextColor',
];

// The Classic layout's "Added" toggle was always Shopify green.
export const FBT_SELECTED_DEFAULTS = { selectedBgColor: '#008060', selectedTextColor: '#ffffff' };

/** Only the extra keys, each a valid #rrggbb or '' (follow the base colour). */
export function pickFbtExtras(tpl) {
  const out = {};
  for (const k of FBT_EXTRA_COLOR_KEYS) {
    out[k] = normalizeHex(tpl?.[k]) || '';
  }
  return out;
}

/** '#rrggbb' a little darker (hover default). */
export function darken(hex, amount = 0.12) {
  const h = normalizeHex(hex);
  if (!h) return hex;
  const n = parseInt(h.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.round(((n >> shift) & 255) * (1 - amount)));
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

/** Every colour the widget draws, with '' extras resolved from the base ones. */
export function fbtEffectiveColors(c) {
  const button = c.buttonColor || '#111827';
  const buttonText = c.buttonTextColor || '#ffffff';
  const text = c.textColor || '#111827';
  return {
    heading: c.headingColor || text,
    title: c.titleColor || text,
    price: c.priceColor || '#059669',
    button,
    buttonText,
    buttonHover: c.buttonHoverColor || darken(button),
    selectedBg: c.selectedBgColor || FBT_SELECTED_DEFAULTS.selectedBgColor,
    selectedText: c.selectedTextColor || FBT_SELECTED_DEFAULTS.selectedTextColor,
    checkbox: c.checkboxColor || button,
    loadingBg: c.loadingBgColor || button,
    successBg: c.successBgColor || button,
    successText: c.successTextColor || buttonText,
  };
}
