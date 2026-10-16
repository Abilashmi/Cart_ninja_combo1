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

// The "Buy all together" offer text's look (also in the template JSON).
// '' colours = follow the price colour (text) / a light tint of it (background),
// which is how it always looked. Mirrored by fbt-widget-render.liquid
// normalizeConfig and fbtOfferCss there.
export const FBT_OFFER_STYLE_DEFAULTS = Object.freeze({
  offerTextColor: '',
  offerBgColor: '',
  offerFontSize: 13,
  offerFontWeight: 700,
  offerItalic: false,
  offerAlign: 'center',
  offerFontFamily: 'inherit', // the theme's font, or a Google font name
  // Once the whole set is picked and the offer is live: a "You save ₹X"
  // line, the bundle total struck through with the new one, and each
  // product's price after its share of the offer.
  offerShowSavings: false,
  offerStrikeTotal: false,
  offerProductPrices: false,
});
export const FBT_OFFER_WEIGHTS = [400, 500, 600, 700, 800];
export const FBT_OFFER_ALIGNS = ['left', 'center', 'right'];
const FONT_NAME_RE = /^[A-Za-z0-9 -]{1,40}$/;

/** The offer text style keys of a template, each valid (bad or missing = default). */
export function pickFbtOfferStyle(tpl) {
  const d = FBT_OFFER_STYLE_DEFAULTS;
  const size = Math.round(Number(tpl?.offerFontSize));
  const weight = Number(tpl?.offerFontWeight);
  const family = String(tpl?.offerFontFamily || '').trim();
  return {
    offerTextColor: normalizeHex(tpl?.offerTextColor) || '',
    offerBgColor: normalizeHex(tpl?.offerBgColor) || '',
    offerFontSize: tpl?.offerFontSize !== '' && tpl?.offerFontSize != null && Number.isFinite(size) ? Math.max(10, Math.min(24, size)) : d.offerFontSize,
    offerFontWeight: FBT_OFFER_WEIGHTS.includes(weight) ? weight : d.offerFontWeight,
    offerItalic: tpl?.offerItalic === true,
    offerAlign: FBT_OFFER_ALIGNS.includes(tpl?.offerAlign) ? tpl.offerAlign : d.offerAlign,
    offerFontFamily: family && family !== 'inherit' && FONT_NAME_RE.test(family) ? family : 'inherit',
    offerShowSavings: tpl?.offerShowSavings === true,
    offerStrikeTotal: tpl?.offerStrikeTotal === true,
    offerProductPrices: tpl?.offerProductPrices === true,
  };
}

/** The offer text's CSS values (React style keys) for a style and the widget's price colour. */
export function fbtOfferCss(style, priceColor = '#059669') {
  const s = pickFbtOfferStyle(style);
  const price = normalizeHex(priceColor) || '#059669';
  return {
    color: s.offerTextColor || price,
    background: s.offerBgColor || `${price}14`,
    fontSize: `${s.offerFontSize}px`,
    fontWeight: s.offerFontWeight,
    fontStyle: s.offerItalic ? 'italic' : 'normal',
    textAlign: s.offerAlign,
    ...(s.offerFontFamily !== 'inherit' ? { fontFamily: `'${s.offerFontFamily}', sans-serif` } : {}),
  };
}

/** The image / spacing keys of a template, each valid (bad or missing = default). */
export function pickFbtLayout(tpl) {
  const out = { ...FBT_LAYOUT_DEFAULTS };
  for (const [k, [min, max]] of Object.entries(FBT_LAYOUT_LIMITS)) {
    const n = Math.round(Number(tpl?.[k]));
    if (tpl?.[k] !== '' && tpl?.[k] != null && Number.isFinite(n)) out[k] = Math.max(min, Math.min(max, n));
  }
  if (FBT_IMAGE_FITS.includes(tpl?.imageFit)) out.imageFit = tpl.imageFit;
  out.imageBg = normalizeHex(tpl?.imageBg) || '';
  // Start with every product selected (a bundle) or let shoppers add each:
  // true / false, null = the interaction style's own default (fbtStartsSelected).
  out.startSelected = tpl?.startSelected === true ? true : tpl?.startSelected === false ? false : null;
  // A variant dropdown on each product (off = the widget adds the rule's / first in-stock variant).
  out.showVariantPicker = tpl?.showVariantPicker === true;
  // AI-Powered mode → "Match the shopper's size" (app/utils/fbt-size.shared.js):
  // the merchant's choice; the widget follows sizeMatchLive, saved true only in AI mode.
  out.sizeMatch = tpl?.sizeMatch === true;
  out.sizeMatchMissing = tpl?.sizeMatchMissing === 'note' ? 'note' : 'hide';
  out.sizeMatchOption = typeof tpl?.sizeMatchOption === 'string' ? tpl.sizeMatchOption.trim().slice(0, 40) : '';
  // The offer text's look rides along (loaded and saved with the layout).
  return { ...out, ...pickFbtOfferStyle(tpl) };
}

/**
 * Whether the widget opens with every product selected. Bundle always does
 * (at least one must stay ticked); otherwise the merchant's choice, else the
 * style's default (Classic yes, Quick Add / Checkbox + Quantity no).
 * Mirrored by fbt-widget-render.liquid. style: classic | bundle | quick-add | checkbox-qty
 * (or the stored quickAdd / checkboxQty).
 */
export function fbtStartsSelected(style, startSelected) {
  if (style === 'bundle') return true;
  if (startSelected === true || startSelected === false) return startSelected;
  return !['quick-add', 'quickAdd', 'checkbox-qty', 'checkboxQty'].includes(style);
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
