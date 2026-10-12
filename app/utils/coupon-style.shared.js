// Coupon card style shared by the admin previews and settings of the cart
// drawer Coupon Slider and the product page Coupon Banner: the built-in SVG
// icons (the same paths as cart_drawer_inline.js CC_ICON_PATHS and
// coupon-slider-render.liquid, which can't import this), the merchant's own
// icon image, icon size / colour / show, the subtitle font and the "Copied"
// button colours. Field names are the same on both features.
export const COUPON_ICON_PATHS = {
  discount: '<path d="M3.25 5.5c0-1.242 1.007-2.25 2.25-2.25.414 0 .75.336.75.75s-.336.75-.75.75-.75.336-.75.75-.336.75-.75.75-.75-.336-.75-.75Z"/><path d="M12.78 7.22c.293.293.293.768 0 1.06l-4.5 4.5c-.293.293-.767.293-1.06 0-.293-.292-.293-.767 0-1.06l4.5-4.5c.293-.293.767-.293 1.06 0Z"/><path d="M9 8c0 .553-.448 1-1 1s-1-.447-1-1c0-.552.448-1 1-1s1 .448 1 1Z"/><path d="M12 13c.552 0 1-.447 1-1 0-.552-.448-1-1-1s-1 .448-1 1c0 .553.448 1 1 1Z"/><path d="M3.25 14.5c0 1.243 1.007 2.25 2.25 2.25.414 0 .75-.335.75-.75 0-.414-.336-.75-.75-.75s-.75-.335-.75-.75c0-.414-.336-.75-.75-.75s-.75.336-.75.75Z"/><path d="M16.75 14.5c0 1.243-1.007 2.25-2.25 2.25-.414 0-.75-.335-.75-.75 0-.414.336-.75.75-.75s.75-.335.75-.75c0-.414.336-.75.75-.75s.75.336.75.75Z"/><path d="M16.75 5.5c0-1.242-1.007-2.25-2.25-2.25-.414 0-.75.336-.75.75s.336.75.75.75.75.336.75.75.336.75.75.75.75-.336.75-.75Z"/><path d="M16 8.25c.414 0 .75.336.75.75v2c0 .415-.336.75-.75.75s-.75-.335-.75-.75v-2c0-.414.336-.75.75-.75Z"/><path d="M11 16.75c.414 0 .75-.335.75-.75 0-.414-.336-.75-.75-.75h-2c-.414 0-.75.336-.75.75 0 .415.336.75.75.75h2Z"/><path d="M4 8.25c.414 0 .75.336.75.75v2c0 .415-.336.75-.75.75s-.75-.335-.75-.75v-2c0-.414.336-.75.75-.75Z"/><path d="M11 4.75c.414 0 .75-.336.75-.75s-.336-.75-.75-.75h-2c-.414 0-.75.336-.75.75s.336.75.75.75h2Z"/>',
  gift: '<path d="M7.835 9.5h-.96c-.343 0-.625-.28-.625-.628 0-.344.28-.622.619-.622.242 0 .463.142.563.363l.403.887Z"/><path d="M10.665 9.5h.96c.343 0 .625-.28.625-.628 0-.344-.28-.622-.619-.622-.242 0-.463.142-.563.363l-.403.887Z"/><path fill-rule="evenodd" d="M8.5 4h-3.25c-1.519 0-2.75 1.231-2.75 2.75v2.25h1.25c.414 0 .75.336.75.75s-.336.75-.75.75h-1.25v2.75c0 1.519 1.231 2.75 2.75 2.75h3.441c-.119-.133-.191-.308-.191-.5v-2c0-.414.336-.75.75-.75s.75.336.75.75v2c0 .192-.072.367-.191.5h4.941c1.519 0 2.75-1.231 2.75-2.75v-2.75h-2.75c-.414 0-.75-.336-.75-.75s.336-.75.75-.75h2.75v-2.25c0-1.519-1.231-2.75-2.75-2.75h-4.75v2.25c0 .414-.336.75-.75.75s-.75-.336-.75-.75v-2.25Zm.297 3.992c-.343-.756-1.097-1.242-1.928-1.242-1.173 0-2.119.954-2.119 2.122 0 1.171.95 2.128 2.125 2.128h.858c-.595.51-1.256.924-1.84 1.008-.41.058-.694.438-.635.848.058.41.438.695.848.636 1.11-.158 2.128-.919 2.803-1.53.121-.11.235-.217.341-.322.106.105.22.213.34.322.676.611 1.693 1.372 2.804 1.53.41.059.79-.226.848-.636.059-.41-.226-.79-.636-.848-.583-.084-1.244-.498-1.839-1.008h.858c1.176 0 2.125-.957 2.125-2.128 0-1.168-.946-2.122-2.119-2.122-.83 0-1.585.486-1.928 1.242l-.453.996-.453-.996Z"/>',
  shipping: '<path fill-rule="evenodd" d="M4.75 4.5a.75.75 0 0 0 0 1.5h3.25a1 1 0 0 1 0 2h-4.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 0 0 1.5h.458a2.5 2.5 0 1 0 4.78.75h3.024a2.5 2.5 0 1 0 4.955-.153 1.75 1.75 0 0 0 1.033-1.597v-1.22a1.75 1.75 0 0 0-1.326-1.697l-1.682-.42a.25.25 0 0 1-.18-.174l-.426-1.494a2.75 2.75 0 0 0-2.645-1.995h-6.991Zm2.75 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
  star: '<path d="M11.128 4.123c-.453-.95-1.803-.95-2.256 0l-1.39 2.912-3.199.421c-1.042.138-1.46 1.422-.697 2.146l2.34 2.222-.587 3.172c-.192 1.034.901 1.828 1.825 1.327l2.836-1.54 2.836 1.54c.924.501 2.017-.293 1.825-1.327l-.587-3.172 2.34-2.222c.762-.724.345-2.008-.697-2.146l-3.2-.421-1.389-2.912Z"/>',
  percent: '<path fill-rule="evenodd" d="M11.527 3.327c-.6-1.306-2.455-1.306-3.054 0a1.68 1.68 0 0 1-2.112.874c-1.347-.5-2.66.813-2.16 2.16a1.68 1.68 0 0 1-.874 2.112c-1.306.6-1.306 2.455 0 3.054a1.68 1.68 0 0 1 .874 2.112c-.5 1.347.813 2.659 2.16 2.16a1.68 1.68 0 0 1 2.112.874c.6 1.306 2.455 1.306 3.054 0a1.68 1.68 0 0 1 2.112-.874c1.347.499 2.66-.813 2.16-2.16a1.68 1.68 0 0 1 .874-2.112c1.306-.6 1.306-2.455 0-3.054a1.68 1.68 0 0 1-.874-2.112c.5-1.347-.813-2.66-2.16-2.16a1.68 1.68 0 0 1-2.112-.874Zm-2.527 4.923a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3.53.53-4 4a.75.75 0 1 1-1.06-1.06l4-4a.75.75 0 1 1 1.06 1.06Zm.47 3.47a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
  cash: '<path d="M9.5 6.5a.75.75 0 0 1 1.5 0v.25h.75a.75.75 0 0 1 0 1.5h-2.25a.5.5 0 0 0 0 1h1a2 2 0 1 1 0 4v.25a.75.75 0 0 1-1.5 0v-.25h-.75a.75.75 0 0 1 0-1.5h2.25a.5.5 0 0 0 0-1h-1a2 2 0 1 1 0-4v-.25Z"/><path fill-rule="evenodd" d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-1.5 0a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z"/>',
};

export const COUPON_ICON_OPTIONS = [
  { label: 'Discount tag', value: 'discount' },
  { label: 'Gift', value: 'gift' },
  { label: 'Free shipping', value: 'shipping' },
  { label: 'Star', value: 'star' },
  { label: 'Percentage', value: 'percent' },
  { label: 'Cash', value: 'cash' },
];

export const COUPON_FONT_WEIGHTS = [
  { label: 'Template default', value: '' },
  { label: 'Normal (400)', value: '400' },
  { label: 'Medium (500)', value: '500' },
  { label: 'Semi-bold (600)', value: '600' },
  { label: 'Bold (700)', value: '700' },
  { label: 'Extra bold (800)', value: '800' },
];

export const hexOrNull = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : null);
export const httpsOrNull = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>()]+$/.test(v.trim()) ? v.trim() : null);
export const pxOrNull = (v, min, max) => {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : Math.max(min, Math.min(max, Math.round(n)));
};

/** SVG markup for a built-in icon. */
export function couponIconSvg(key, size, color) {
  const paths = COUPON_ICON_PATHS[key] || COUPON_ICON_PATHS.discount;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" fill="${color}" style="display:block;flex-shrink:0;">${paths}</svg>`;
}

/**
 * The icon a coupon card shows, as HTML ('' when hidden): the merchant's own
 * image, else the chosen SVG in the merchant's colour, at their size.
 * style = { iconShow, icon, iconImage, iconColor, iconSize }.
 */
export function couponIconHtml(style, { size, color, defaultShow = true, defaultIcon = 'discount' } = {}) {
  const st = style || {};
  const show = st.iconShow === undefined || st.iconShow === null ? defaultShow : st.iconShow !== false;
  if (!show) return '';
  const s = pxOrNull(st.iconSize, 8, 48) || size;
  const image = httpsOrNull(st.iconImage);
  if (image) return `<img src="${image.replace(/"/g, '&quot;')}" alt="" width="${s}" height="${s}" style="width:${s}px;height:${s}px;object-fit:contain;display:block;flex-shrink:0;">`;
  return couponIconSvg(st.icon || defaultIcon, s, hexOrNull(st.iconColor) || color);
}

/** React style for the subtitle (description) from the merchant's font settings over the card's own. */
export function couponSubtitleStyle(style, defaults = {}) {
  const st = style || {};
  const size = pxOrNull(st.subFontSize, 6, 24);
  const weight = /^[1-9]00$/.test(String(st.subFontWeight || '')) ? String(st.subFontWeight) : null;
  const color = hexOrNull(st.subColor);
  return {
    ...defaults,
    ...(size ? { fontSize: `${size}px` } : {}),
    ...(weight ? { fontWeight: weight } : {}),
    ...(color ? { color, opacity: 1 } : {}),
  };
}
