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

// Image and spacing settings, in px (also in the template JSON). Defaults
// are what the widget always drew, so widgets saved before look the same.
// Mirrored by fbt-widget-render.liquid normalizeConfig (fbtNum).
export const FBT_LAYOUT_DEFAULTS = Object.freeze({
  imageSize: 64, // card image height; list rows use 75% of it (48 by default)
  imageFit: 'contain', // contain = whole image | cover = fill the box
  imageRadius: 8,
  imageBg: '', // '' = a light tint of the border colour
  cardWidth: 140, // carousel cards
  gap: 10, // between products
  cardPadding: 10, // inside each card (sides 2px less); list rows +2
  widgetPadding: 20, // inside the widget; phones get 70%
  marginTop: 16,
  marginBottom: 16,
});

export const FBT_LAYOUT_LIMITS = Object.freeze({
  imageSize: [40, 200],
  imageRadius: [0, 100],
  cardWidth: [100, 280],
  gap: [0, 40],
  cardPadding: [0, 30],
  widgetPadding: [0, 48],
  marginTop: [0, 80],
  marginBottom: [0, 80],
});

export const FBT_IMAGE_FITS = ['contain', 'cover'];

/** The image / spacing keys of a template, each valid (bad or missing = default). */
export function pickFbtLayout(tpl) {
  const out = { ...FBT_LAYOUT_DEFAULTS };
  for (const [k, [min, max]] of Object.entries(FBT_LAYOUT_LIMITS)) {
    const n = Math.round(Number(tpl?.[k]));
    if (tpl?.[k] !== '' && tpl?.[k] != null && Number.isFinite(n)) out[k] = Math.max(min, Math.min(max, n));
  }
  if (FBT_IMAGE_FITS.includes(tpl?.imageFit)) out.imageFit = tpl.imageFit;
  out.imageBg = normalizeHex(tpl?.imageBg) || '';
  return out;
}

/** Sizes the widget draws from a layout (rows and phones are derived). */
export function fbtLayoutSizes(l) {
  return {
    rowImage: Math.round(l.imageSize * 0.75),
    phonePadding: Math.round(l.widgetPadding * 0.7),
    cardPadding: `${l.cardPadding}px ${Math.max(0, l.cardPadding - 2)}px`,
    rowPadding: l.cardPadding + 2,
  };
}
