// The cart drawer's width and spacing, one set per device, set in Cart
// Editor → Design → Layout and stored in cart_drawer.checkout_button_style as
// `phoneLayout` / `desktopLayout` (blob only, like `continueShopping`, so no
// new columns). Mirrored by cart_drawer_inline.js `ccDrawerLayout`: keep the
// two in step.
//
// Phone = the storefront below 481px wide (width: below 750px, where the
// drawer used to be full width), desktop = wider. Numbers are px, except the
// phone drawerWidth (% of the screen). A third limit is the step (product
// text sizes go by half pixels; the rest by whole ones). The defaults are what the drawer drew
// before these settings existed. foldSummary = only Total shows in the footer
// until the shopper taps "Details" (the breakdown and the footer note open);
// showItemsHeading / showFooterNote hide the "Items included" row and the
// "Shipping ... calculated at checkout" note.

export const LAYOUT_DEVICES = ['phone', 'desktop'];

const SPACING_LIMITS = {
  // Top bars
  announcementPadding: [0, 20],
  countdownPadding: [0, 20],
  headerPadding: [4, 32],
  // Body
  bodyPadding: [0, 32],
  sectionGap: [0, 32],
  // Progress bar
  progressPadding: [0, 24],
  progressHeadingGap: [0, 24],
  progressHeadingSize: [10, 22],
  progressLabelGap: [0, 24],
  // Product rows
  itemPadding: [4, 24],
  itemGap: [0, 24],
  itemImageSize: [40, 120],
  itemTitleSize: [10, 22, 0.5],
  itemPriceSize: [10, 20, 0.5],
  itemTotalSize: [10, 24, 0.5],
  // Footer
  footerPadding: [4, 32],
  summaryRowGap: [0, 16],
  summaryGap: [0, 32],
  buttonGap: [0, 24],
};

export const LAYOUT_LIMITS = {
  phone: { drawerWidth: [70, 100], ...SPACING_LIMITS },
  desktop: { drawerWidth: [320, 640], ...SPACING_LIMITS },
};

export const LAYOUT_FLAGS = ['foldSummary', 'showItemsHeading', 'showFooterNote'];

export const DEFAULT_LAYOUT = {
  phone: Object.freeze({
    drawerWidth: 100,
    announcementPadding: 6,
    countdownPadding: 6,
    headerPadding: 10,
    bodyPadding: 10,
    sectionGap: 8,
    progressPadding: 2,
    progressHeadingGap: 6,
    progressHeadingSize: 14,
    progressLabelGap: 10,
    itemPadding: 12,
    itemGap: 12,
    itemImageSize: 64,
    itemTitleSize: 13.5,
    itemPriceSize: 13,
    itemTotalSize: 14,
    footerPadding: 10,
    summaryRowGap: 4,
    summaryGap: 8,
    buttonGap: 10,
    foldSummary: true,
    showItemsHeading: true,
    showFooterNote: true,
  }),
  desktop: Object.freeze({
    drawerWidth: 420,
    announcementPadding: 8,
    countdownPadding: 8,
    headerPadding: 16,
    bodyPadding: 16,
    sectionGap: 12,
    progressPadding: 8,
    progressHeadingGap: 12,
    progressHeadingSize: 15,
    progressLabelGap: 10,
    itemPadding: 14,
    itemGap: 12,
    itemImageSize: 76,
    itemTitleSize: 14,
    itemPriceSize: 13,
    itemTotalSize: 15,
    footerPadding: 20,
    summaryRowGap: 8,
    summaryGap: 16,
    buttonGap: 10,
    foldSummary: false,
    showItemsHeading: true,
    showFooterNote: true,
  }),
};

/** device: 'phone' | 'desktop'. */
export function sanitizeDrawerLayout(raw, device) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const defaults = DEFAULT_LAYOUT[device];
  const out = {};
  for (const [key, [min, max, step = 1]] of Object.entries(LAYOUT_LIMITS[device])) {
    const n = Math.round(Number(d[key]) / step) * step;
    out[key] = d[key] !== null && d[key] !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaults[key];
  }
  for (const key of LAYOUT_FLAGS) out[key] = typeof d[key] === 'boolean' ? d[key] : defaults[key];
  return out;
}
