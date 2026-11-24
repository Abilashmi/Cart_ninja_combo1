// Cart drawer colour theme (Cart Editor → Design → Colour theme): the drawer's
// background as one colour or a mix of two (a gradient, like chat themes), plus
// the text colour drawn straight on it (auto = dark or light by how bright the
// background is). Saved in the legacy `cart_drawer.checkout_button_style` blob
// as `theme`, so no new columns. Not saved = the plain white drawer as before.
//
// Mirrored by cart_drawer_inline.js `ccDrawerTheme` / `ccDrawerThemeCss`:
// tests/cart-drawer/drawer-theme.test.mjs compares them.

export const THEME_PRESETS = [
  { id: 'peach', label: 'Peach', c1: '#ffe3d8', c2: '#ffd1e3' },
  { id: 'sunset', label: 'Sunset', c1: '#ffd6a5', c2: '#ff9ebb' },
  { id: 'ocean', label: 'Ocean', c1: '#cde9ff', c2: '#b9f3e4' },
  { id: 'lavender', label: 'Lavender', c1: '#e6ddff', c2: '#ffd9f0' },
  { id: 'mint', label: 'Mint', c1: '#d9f7e8', c2: '#e8f5ff' },
  { id: 'lemon', label: 'Lemon', c1: '#fff6c9', c2: '#ffe0b5' },
  { id: 'rose', label: 'Rose', c1: '#ffe0ea', c2: '#ffc9d9' },
  { id: 'berry', label: 'Berry', c1: '#5b2a86', c2: '#c0366f' },
  { id: 'night', label: 'Night', c1: '#1f2340', c2: '#3b2a63' },
  { id: 'forest', label: 'Forest', c1: '#123d2f', c2: '#1f6b4f' },
  { id: 'graphite', label: 'Graphite', c1: '#2b2b33', c2: '#4a4a57' },
];

export const THEME_DEFAULT_ANGLE = 160;
export const THEME_DEFAULT_CUSTOM = Object.freeze({ color1: '#ffe3d8', color2: '#ffd1e3' });

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hex(v, def) {
  if (typeof v !== 'string' || !HEX.test(v.trim())) return def;
  let h = v.trim().toLowerCase();
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h;
}

// Saved JSON (or nothing) -> { preset, color1, color2, angle, textColor } or null.
// color2 '' = a single colour. textColor '' = automatic.
export function sanitizeDrawerTheme(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let found = null;
  for (let i = 0; i < THEME_PRESETS.length; i++) if (THEME_PRESETS[i].id === raw.preset) found = THEME_PRESETS[i];
  const a = parseInt(raw.angle, 10);
  const angle = isFinite(a) ? Math.max(0, Math.min(360, a)) : THEME_DEFAULT_ANGLE;
  const text = typeof raw.textColor === 'string' && HEX.test(raw.textColor.trim()) ? hex(raw.textColor, '') : '';
  if (found) return { preset: found.id, color1: found.c1, color2: found.c2, angle, textColor: text };
  const color1 = hex(raw.color1, '');
  if (!color1) return null;
  return { preset: 'custom', color1, color2: raw.color2 ? hex(raw.color2, '') : '', angle, textColor: text };
}

function brightness(h) {
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// theme from sanitizeDrawerTheme(). null when there is no theme.
// -> { background, color, dark }: `color` is the text colour on the drawer.
export function drawerThemeCss(theme) {
  if (!theme) return null;
  const b = theme.color2 ? (brightness(theme.color1) + brightness(theme.color2)) / 2 : brightness(theme.color1);
  const dark = b < 0.5;
  return {
    background: theme.color2 ? 'linear-gradient(' + theme.angle + 'deg, ' + theme.color1 + ', ' + theme.color2 + ')' : theme.color1,
    color: theme.textColor || (dark ? '#ffffff' : '#111827'),
    dark,
  };
}
