// Build a Combo setup tour: the ordered steps and the tiny bit of persisted
// state (which step the merchant is on, or that they finished / dismissed it).
// The tour spans two routes (/app/bundles and /app/bundles/customize), so its
// position lives in localStorage rather than component state.

export const COMBO_TOUR_KEY = 'cn_combo_tour_v1';

// The tour's memory is per store: a merchant who installs the app on a second
// store gets the first-time tour there too. Pages call setTourShop(shop) before
// reading or writing (ComboSetupTour does it on every render, so it is always set).
let tourShop = '';
export function setTourShop(shop) { tourShop = String(shop || ''); }
export const tourStorageKey = () => (tourShop ? `${COMBO_TOUR_KEY}:${tourShop}` : COMBO_TOUR_KEY);
export const COMBO_TOUR_EVENT = 'cn-combo-tour-changed';

// page: which screen owns the step. target: CSS selector of what it points at
// (null = a centered card). advanceOnClick: a click on this selector moves the
// tour on by itself. beforeStep: a hint to the page to open something first.
export const COMBO_TOUR_STEPS = [
  {
    id: 'create', page: 'dashboard', target: '[data-tour="combo-create"]',
    title: 'Start by creating a template',
    body: 'Click Create a bundle (or Create Template below). You will choose how your combo looks on the next screen.',
    nextLabel: 'Create template', clickTarget: true, advanceOnClick: '[data-tour="combo-create"]',
  },
  {
    id: 'template', page: 'picker', target: '.template-picker-grid',
    title: 'Pick a template',
    body: 'Each layout is a different shopping experience. Choose the one that fits your products. You can change everything about it afterwards.',
    nextLabel: 'Got it', advanceOnClick: '.tpl-pick-card button', hideNext: true,
  },
  {
    id: 'ai', page: 'builder', target: '.bxb-bar',
    title: 'Customize it with AI',
    body: 'Tell Brix what you want: the layout, the wording, colours or products. It changes your template for you.',
  },
  {
    id: 'preview', page: 'builder', target: '[data-tour="combo-preview"]',
    title: 'Tap the preview to edit',
    body: 'This is your live preview. Click any part of it, like the title, a product card or a button, to jump straight to its settings and change it.',
  },
  {
    id: 'discount', page: 'builder', target: '[data-tour="combo-discount"]', beforeStep: 'discount',
    title: 'Add a discount',
    body: 'Turn on the coupon to reward shoppers who build a bundle. Pick an existing discount, or create a new one right here.',
  },
  {
    id: 'save', page: 'builder', target: '[data-tour="combo-save"]',
    title: 'Save your template',
    body: 'Click Save Template to keep your work. Activate it when you are ready to publish the combo page to your store.',
  },
  {
    id: 'embed', page: 'builder', target: null, kind: 'embed',
    title: 'Last step: turn on the app embed',
    body: '',
    nextLabel: 'Finish',
  },
];

const safeRead = () => {
  try { return JSON.parse(localStorage.getItem(tourStorageKey()) || 'null'); } catch { return null; }
};

/** { status: 'active'|'dismissed'|'done', step: number } or null if never started. */
export function readTour() {
  const value = safeRead();
  if (!value || typeof value !== 'object') return null;
  const step = Number.isInteger(value.step) ? Math.min(Math.max(value.step, 0), COMBO_TOUR_STEPS.length - 1) : 0;
  const status = ['active', 'dismissed', 'done'].includes(value.status) ? value.status : 'dismissed';
  return { status, step };
}

export function writeTour(state) {
  try { localStorage.setItem(tourStorageKey(), JSON.stringify(state)); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent(COMBO_TOUR_EVENT)); } catch { /* no window */ }
}

export const startTour = () => writeTour({ status: 'active', step: 0 });
export const dismissTour = (step = 0) => writeTour({ status: 'dismissed', step });
export const finishTour = () => writeTour({ status: 'done', step: COMBO_TOUR_STEPS.length - 1 });
export const goToStep = (step) => writeTour({ status: 'active', step });

/** Index of the first step at or after `from` (moving by `dir`) owned by `page`, else -1. */
export function nextStepOnPage(from, dir, page) {
  for (let i = from; i >= 0 && i < COMBO_TOUR_STEPS.length; i += dir) {
    if (COMBO_TOUR_STEPS[i].page === page) return i;
  }
  return -1;
}
