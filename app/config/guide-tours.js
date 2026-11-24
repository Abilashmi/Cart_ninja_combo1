/**
 * Guided setup: one tour per BRIX feature (the right-side panel lists its
 * steps; components/guide/GuideSpotlight.jsx points at each step's element).
 * Pure data, no imports beyond the video list, so the server
 * (services/guide-state.server.js) can check saved step positions against it.
 *
 * Every step lives on the feature's own pages. While the merchant is on Home,
 * the guide points at the feature card's Customize button instead (not a
 * numbered step), which opens the page of the step the tour is on.
 *
 * A step:
 *   id      stable id, saved in the merchant's progress (never rename one)
 *   route   the page it lives on (pathname). `search` is added on Next.
 *   target  data-tour id of what gets the spotlight
 *   reveal  data-tour id of the accordion row / button that shows the target:
 *           clicked first when it reports aria-expanded="false" /
 *           aria-selected="false", or when the target isn't on the page
 *           (a wrapper is clicked through its first button).
 *   revealEvent  id sent in the `brix:guide-reveal` event, for pages that
 *           switch tabs or sections by state (utils/guide-runtime.js
 *           useGuideReveal); nothing is clicked for it.
 *   click   data-tour id whose click (by the merchant) moves the tour on.
 *           Left out = only Next moves on (settings the merchant edits).
 *   kind    'save' = the last step: its Next is "Check & finish" (and its
 *           `click`, the page's Save button, checks too): BRIX checks on the
 *           server that the feature's settings are really saved
 *           (services/guide-status.server.js `configured`) before the
 *           feature counts as set up.
 * Only real controls are named here: each target id is set in the page's own JSX.
 */
import { TUTORIAL_VIDEOS } from '../utils/tutorial-videos.js';

// An accordion section of an editor: the guide opens it by its row and the open
// section gets the spotlight. When the merchant clicks that row themselves
// (closing the section they're done with), the tour moves on; clicks on the
// settings inside never do.
const section = (prefix, sectionId, route, title, body, extra = {}) => ({
  id: sectionId,
  route,
  target: `${prefix}-section-${sectionId}`,
  reveal: `${prefix}-section-${sectionId}-toggle`,
  click: `${prefix}-section-${sectionId}-toggle`,
  title,
  body,
  ...extra,
});

const COD = '/app/cod/customize';
const CART = '/app/cartdrawer';
const FBT = '/app/fbt';
const COUPON = '/app/productwidget';
const PACK_NEW = '/app/packs/new';
const DISCOUNT_NEW = '/app/discounts/create';
const BRIX_AI = '/app/brix-ai';
const COMBO_BUILDER = '/app/bundles/customize';

export const GUIDE_TOURS = {
  cod: {
    video: null,
    steps: [
      {
        id: 'turn-on', route: COD, target: 'cod-active',
        title: 'Turn on Cash on Delivery',
        body: 'This switch turns COD on for your store. Make it say Active, then press Next. Nothing reaches shoppers until you save.',
      },
      section('cod', 'position', COD, 'Choose where the COD button shows',
        'Start with the cart drawer: replace Checkout or sit above or below it, with your own text and colours. Product page and Combo page are the next two rows.'),
      section('cod', 'fee', COD, 'Set a COD fee and rules',
        'Charge an optional COD fee (a fixed amount or a % of the order). Eligibility and Fraud protection below set the order limits, OTP and blocked PIN codes.'),
      section('cod', 'sms', COD, 'Connect OTP by SMS',
        'Shoppers confirm their phone with a code by SMS before a COD order. Add your MSG91 keys here, or use BRIX\'s OTP credits where offered.'),
      section('cod', 'prepaid', COD, 'Add a prepaid discount to move shoppers online',
        'Give a % off to shoppers who pay online. Then click Save at the top: BRIX checks your COD settings were saved before moving on.',
        { kind: 'save', click: 'cod-save' }),
    ],
  },

  cart: {
    video: { ...TUTORIAL_VIDEOS.cartDrawer, title: 'admin.home.step2_title', desc: 'admin.home.step2_desc' },
    steps: [
      section('cart', 'design', CART, 'Design your drawer',
        'Pick the drawer\'s colours, fonts and layout. The preview on the right updates as you change them.'),
      section('cart', 'announcements', CART, 'Add an announcement bar',
        'Switch on the bar at the top of the drawer and write up to 10 messages that rotate.'),
      section('cart', 'progressBar', CART, 'Add a progress bar',
        'Add milestones such as free shipping or a free gift that fill up as the cart grows.'),
      section('cart', 'upsellProducts', CART, 'Suggest upsell products',
        'Suggest products inside the cart: pick them yourself, generate rules with AI, or use Smart Recommendations.'),
      section('cart', 'couponSlider', CART, 'Show your coupons',
        'Show your discount codes in the drawer so shoppers can copy or apply them.'),
      section('cart', 'checkoutButton', CART, 'Style the checkout button',
        'Set the checkout button\'s text, colours and size. Then click Save: BRIX checks your drawer was saved before moving on.',
        { kind: 'save', click: 'cart-save' }),
    ],
  },

  fbt: {
    video: { ...TUTORIAL_VIDEOS.fbt, title: 'admin.home.step3_title', desc: 'admin.home.step3_desc' },
    steps: [
      {
        id: 'template', route: FBT, target: 'fbt-template', click: 'fbt-template-option',
        title: 'Choose a template',
        body: 'Pick the look of the widget. You can change every colour and the layout afterwards.',
      },
      section('fbt', 'interaction', FBT, 'Set the layout',
        'Choose how shoppers pick products (checkboxes, a bundle, or one by one) and how the products are arranged.'),
      section('fbt', 'offer', FBT, 'Add a bundle offer',
        'Optional: give a discount when the shopper buys the whole set together.'),
      {
        id: 'configure', route: FBT, target: 'fbt-configure', click: 'fbt-configure',
        title: 'Choose the products',
        body: 'Click Configure to choose which products are suggested together, yourself or with AI.',
      },
      {
        // Moves on by itself when the merchant closes the Configure window (Save or Cancel).
        id: 'products', route: FBT, target: 'fbt-config-mode', reveal: 'fbt-configure', advanceWhenGone: true,
        title: 'Manual or AI-Powered',
        body: 'Manual: pick the trigger product and the products to offer with it. AI-Powered: BRIX pairs your products for you. Then click Save in this window.',
      },
      {
        id: 'save', route: FBT, target: 'fbt-save', click: 'fbt-save', kind: 'save',
        title: 'Save FBT',
        body: 'Click Save. Already saved in the Configure window? Press Check & finish. BRIX then checks your products and settings were saved.',
      },
    ],
  },

  combo: {
    video: { ...TUTORIAL_VIDEOS.comboBuilder, title: 'admin.home.step5_title', desc: 'admin.home.step5_desc' },
    steps: [
      {
        id: 'create', route: '/app/bundles', target: 'combo-create', click: 'combo-create',
        title: 'Create a combo page',
        body: 'Click Create a bundle. You choose how your combo is priced on the next screen.',
      },
      {
        id: 'template', route: COMBO_BUILDER, target: 'combo-templates', click: 'combo-template-pick',
        title: 'Pick a template',
        body: 'Quantity Box, Weight Box or Value Box: each is priced by one measure. Click Use This Template on the one that fits.',
      },
      {
        id: 'preview', route: COMBO_BUILDER, target: 'combo-preview',
        title: 'Edit from the preview',
        body: 'This is your live combo page. Click any part of it, like the title or a product card, to jump to its settings.',
      },
      {
        id: 'offer', route: COMBO_BUILDER, target: 'combo-discount', revealEvent: 'combo-discount',
        title: 'Set the offer',
        body: 'Add the box tiers: what the shopper gets for filling the box (a % off, an amount off, or a box price).',
      },
      {
        id: 'save', route: COMBO_BUILDER, target: 'combo-save', click: 'combo-save', kind: 'save',
        title: 'Save the template',
        body: 'Click Save Template. BRIX then checks your combo was saved. Activate it when you are ready to publish it.',
      },
    ],
  },

  packs: {
    video: null,
    steps: [
      {
        id: 'create', route: '/app/packs', target: 'packs-create', click: 'packs-create',
        title: 'Create a Pack',
        body: 'Click Create Pack to start a quantity offer, like Buy 2 and save 10%.',
      },
      {
        id: 'product', route: PACK_NEW, target: 'packs-step-product', revealEvent: 'packs-step-product',
        title: 'Choose the product',
        body: 'Pick the product this Pack is for. Then press Continue.',
      },
      {
        id: 'type', route: PACK_NEW, target: 'packs-step-type', revealEvent: 'packs-step-type',
        title: 'Pick the Pack type',
        body: 'Choose the kind of offer: packs of the same product, mix and match, or a fixed combo.',
      },
      {
        id: 'configure', route: PACK_NEW, target: 'packs-step-configure', revealEvent: 'packs-step-configure',
        title: 'Set the packs',
        body: 'Add each pack size and its saving (% off, amount off or a set price).',
      },
      {
        id: 'design', route: PACK_NEW, target: 'packs-step-design', revealEvent: 'packs-step-design',
        title: 'Choose a template',
        body: 'Pick how the Packs look on your product page.',
      },
      {
        id: 'review', route: PACK_NEW, target: 'packs-save', revealEvent: 'packs-step-review', click: 'packs-save-button', kind: 'save',
        title: 'Review and save',
        body: 'Check the prices BRIX worked out, then Save as draft or Save & activate. BRIX then checks the Pack was saved.',
      },
    ],
  },

  coupon: {
    video: { ...TUTORIAL_VIDEOS.couponBanner, title: 'admin.home.step4_title', desc: 'admin.home.step4_desc' },
    steps: [
      {
        id: 'template', route: COUPON, target: 'coupon-template', click: 'coupon-template-option',
        title: 'Choose a template',
        body: 'Pick the banner\'s look. You can change its colours and layout afterwards.',
      },
      section('coupon', 'coupon', COUPON, 'Pick your coupons',
        'Tick the discount codes to show on product pages. You can also add a text offer or an offer ladder.'),
      section('coupon', 'text', COUPON, 'Customize the coupons',
        'Edit each coupon\'s heading, subtitle, colours and the pages it shows on.'),
      section('coupon', 'design', COUPON, 'Choose the layout',
        'Choose a list, grid or carousel, the headings, and where the banner sits on the page.'),
      {
        id: 'turn-on', route: COUPON, target: 'coupon-toggle', click: 'coupon-save', kind: 'save',
        title: 'Switch it on and save',
        body: 'This switch shows the banner on your product pages. Then click Save: BRIX checks your coupons were saved.',
      },
    ],
  },

  discounts: {
    video: null,
    steps: [
      {
        id: 'create', route: '/app/coupons', target: 'discounts-create', click: 'discounts-create',
        title: 'Create a discount',
        body: 'Click Create Discount to make a discount code or an automatic discount in Shopify.',
      },
      {
        id: 'type', route: DISCOUNT_NEW, target: 'discounts-type',
        title: 'Discount type',
        body: 'Percentage, fixed amount, free shipping or Buy X get Y.',
      },
      {
        id: 'method', route: DISCOUNT_NEW, target: 'discounts-method',
        title: 'Code or automatic',
        body: 'Automatic discounts apply by themselves at checkout. A discount code is typed in by the shopper.',
      },
      {
        id: 'steps', route: DISCOUNT_NEW, target: 'discounts-steps',
        title: 'Fill in each step',
        body: 'Value, products, limits and dates. Press Next at the bottom to move through them.',
      },
      {
        id: 'save', route: DISCOUNT_NEW, target: 'discounts-nav', click: 'discounts-save', kind: 'save',
        title: 'Save the discount',
        body: 'On the last step click Save discount. BRIX then checks the discount exists in Shopify. Already saved one? Press Check & finish.',
      },
    ],
  },

  brix_ai: {
    video: { ...TUTORIAL_VIDEOS.brixAi, title: 'admin.home.step1_title', desc: 'admin.home.step1_desc' },
    steps: [
      {
        id: 'try', route: BRIX_AI, target: 'ai-chip-build-a-bundle', click: 'ai-chip-build-a-bundle',
        title: 'Try "Build a bundle"',
        body: 'Click this suggestion to put it in the message box. You can also type your own request.',
      },
      {
        id: 'ask', route: BRIX_AI, target: 'ai-input', click: 'ai-send',
        title: 'Ask Brix',
        body: 'Press Ask Brix to send it. Each message uses one AI credit.',
      },
      {
        id: 'review', route: BRIX_AI, target: 'ai-messages', kind: 'save',
        title: 'Review and save what Brix changed',
        body: 'Brix answers here and says what it changed. Open that feature to review it and save.',
      },
    ],
  },
};

/** The step ids of a feature's tour, in order. */
export function guideStepIds(moduleId) {
  return (GUIDE_TOURS[moduleId]?.steps || []).map((s) => s.id);
}
