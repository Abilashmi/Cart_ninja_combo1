// Drag-and-drop order of the cart drawer's parts (Cart Editor preview: drag any
// part). Saved in the legacy `cart_drawer.checkout_button_style` blob as
// `sectionOrder` = { main: [...], footer: [...] }, so no new columns. Not saved =
// the drawer as before (each part's own position setting).
//
// Two lists:
//   main   = header, announcement bar, countdown timer, progress bar, coupons,
//            image banner, upsell, cart items (top to bottom, any order)
//   footer = price summary, continue shopping, checkout (+ COD), cards, trust badges
//
// The header / announcement / countdown that lead the main list stay fixed above
// the scrolling body; one dragged below a body part is drawn inside the body.
//
// Mirrored by cart_drawer_inline.js `ccSectionOrder` / `ccApplySectionOrder`:
// tests/cart-drawer/section-order.test.mjs compares them.

export const TOP_KEYS = ['header', 'announcement', 'countdown'];
export const SECTION_ZONES = {
  main: ['header', 'announcement', 'countdown', 'progress', 'coupons', 'banner', 'upsell', 'items'],
  footer: ['summary', 'continue', 'checkout', 'cards', 'trust'],
};

export const SECTION_LABELS = {
  header: 'Header',
  announcement: 'Announcement',
  countdown: 'Countdown timer',
  progress: 'Progress bar',
  coupons: 'Coupons',
  banner: 'Image banner',
  upsell: 'Upsell products',
  items: 'Cart items',
  summary: 'Price summary',
  continue: 'Continue shopping',
  checkout: 'Checkout button',
  cards: 'Payment cards',
  trust: 'Trust badges',
};

// Saved JSON (or nothing) -> { main, footer } with every key once, or null when
// nothing was saved. Unknown keys are dropped, missing ones are added at the end
// in their default order. An earlier { top, body } save is joined into main.
export function sanitizeSectionOrder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const src = {
    main: Array.isArray(raw.main) ? raw.main : [].concat(Array.isArray(raw.top) ? raw.top : [], Array.isArray(raw.body) ? raw.body : []),
    footer: Array.isArray(raw.footer) ? raw.footer : [],
  };
  const out = {};
  Object.keys(SECTION_ZONES).forEach((zone) => {
    const valid = SECTION_ZONES[zone];
    const seen = [];
    src[zone].forEach((k) => { if (valid.indexOf(k) >= 0 && seen.indexOf(k) < 0) seen.push(k); });
    valid.forEach((k) => { if (seen.indexOf(k) < 0) seen.push(k); });
    out[zone] = seen;
  });
  return out;
}

// The order the drawer shows today, from each part's own position setting:
// what a merchant's first drag starts from, so nothing jumps.
export function deriveSectionOrder(f) {
  const facts = f || {};
  const bannerNums = { top: -30, afterTopBar: -15, beforeProducts: 0, afterProducts: 2, beforeBottomBar: 975, afterBottomBar: 985, end: 1000 };
  const bodyKeys = ['progress', 'coupons', 'banner', 'upsell', 'items'];
  const nums = {
    progress: facts.progressPos === 'bottom' ? 980 : -20,
    coupons: facts.couponPos === 'bottom' ? 990 : -10,
    banner: bannerNums[facts.bannerSlot] != null ? bannerNums[facts.bannerSlot] : -30,
    upsell: facts.upsellPos === 'bottom' ? 3 : -5,
    items: 1,
  };
  const body = bodyKeys.slice().sort((a, b) => (nums[a] - nums[b]) || (bodyKeys.indexOf(a) - bodyKeys.indexOf(b)));
  const footer = ['summary'];
  if (facts.continuePlacement === 'above') footer.push('continue');
  if (facts.trustPlacement === 'above') footer.push('trust');
  footer.push('checkout', 'cards');
  if (facts.trustPlacement !== 'above') footer.push('trust');
  if (facts.continuePlacement !== 'above') footer.push('continue');
  return { main: TOP_KEYS.concat(body), footer };
}

// Moves `from` to where `to` is, inside one list.
export function moveSection(order, zone, from, to) {
  const base = sanitizeSectionOrder(order);
  if (!base || !base[zone] || from === to) return base;
  const fromAt = base[zone].indexOf(from);
  const at = base[zone].indexOf(to);
  if (at < 0 || fromAt < 0) return base;
  const list = base[zone].filter((k) => k !== from);
  // Dragging down puts it after the target, dragging up before it.
  const insertAt = fromAt < at ? list.indexOf(to) + 1 : list.indexOf(to);
  list.splice(insertAt, 0, from);
  return { ...base, [zone]: list };
}
