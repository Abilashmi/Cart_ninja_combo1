/**
 * Store-wide font for every BRIX widget on the storefront (cart drawer, COD
 * buttons + popup + payment options, Frequently Bought Together, Coupon
 * Banner, Packs, combo pages). '' = the theme's own font (the default: nothing
 * changes). Saved with the price display in the app-data metafield
 * brix.display (services/price-display.server.js) as { font, fontQuery }; the
 * storefront snippet brix-font.liquid loads the Google font from fontQuery and
 * sets --brix-font, which every widget uses.
 *
 * Only fonts from this list are saved, so the Liquid can print the name and
 * query as they are. Each query asks only for weights that font has (Google
 * refuses the whole request otherwise); checked against fonts.googleapis.com.
 */
export const BRIX_FONTS = [
  { name: 'Inter', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Poppins', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Roboto', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Montserrat', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Open Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Lato', weights: '400;700', kind: 'sans' },
  { name: 'Nunito', weights: '400;500;600;700', kind: 'sans' },
  { name: 'DM Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Plus Jakarta Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Manrope', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Outfit', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Jost', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Rubik', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Work Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Mulish', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Raleway', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Barlow', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Josefin Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Quicksand', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Noto Sans', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Mukta', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Hind', weights: '400;500;600;700', kind: 'sans' },
  { name: 'Playfair Display', weights: '400;500;600;700', kind: 'serif' },
  { name: 'Lora', weights: '400;500;600;700', kind: 'serif' },
  { name: 'Merriweather', weights: '400;700', kind: 'serif' },
  { name: 'Cormorant Garamond', weights: '400;500;600;700', kind: 'serif' },
];

const BY_NAME = new Map(BRIX_FONTS.map((f) => [f.name.toLowerCase(), f]));

/** A listed font, or null (= the theme's font). */
export function brixFontEntry(name) {
  return BY_NAME.get(String(name || '').trim().toLowerCase()) || null;
}

/** The family part of a Google Fonts css2 URL, e.g. "Open+Sans:wght@400;700". */
export function brixFontQuery(entry) {
  return entry ? `${entry.name.replace(/ /g, '+')}:wght@${entry.weights}` : '';
}

/** CSS font-family for a saved font ('' = inherit the theme's). */
export function brixFontStack(name) {
  const entry = brixFontEntry(name);
  if (!entry) return '';
  return `'${entry.name}', ${entry.kind === 'serif' ? 'Georgia, serif' : 'system-ui, -apple-system, "Segoe UI", sans-serif'}`;
}

/**
 * What is saved: all '' for the theme's font, else the listed name, its
 * Google query and its CSS stack (printed by brix-font.liquid as they are).
 */
export function sanitizeBrixFont(name) {
  const entry = brixFontEntry(name);
  if (!entry) return { font: '', fontQuery: '', fontStack: '' };
  return { font: entry.name, fontQuery: brixFontQuery(entry), fontStack: brixFontStack(entry.name) };
}

/** Google Fonts stylesheet URL for the admin's sample ('' for the theme's font). */
export function brixFontHref(name) {
  const entry = brixFontEntry(name);
  return entry ? `https://fonts.googleapis.com/css2?family=${brixFontQuery(entry)}&display=swap` : '';
}
