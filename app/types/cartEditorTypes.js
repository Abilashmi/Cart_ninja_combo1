// Cart Editor Type Definitions

export const defaultTier = {
  id: 'tier-1',
  minimumSpend: 500,
  title: 'First Reward',
  description: 'Unlock your first milestone reward',
  icon: 'gift',
  rewardProducts: [],
  rewardProductCount: 0,
  // 'free' = BRIX makes the reward product free at checkout (via its discount
  // Function once the milestone is reached); 'regular' = added at its normal price.
  rewardPricing: 'free',
  // Merchant-authored template shown while this tier is NOT YET reached —
  // supports {amount}/{items}/{target} placeholders, filled in dynamically
  // from the current progress mode/cart value at render time (see
  // fillProgressMessageTemplate in CartPreview.jsx and cart_drawer_inline.js).
  // Left blank by default; a tier with no value here (including every tier
  // saved before this field existed) falls back to
  // "You're {amount} away from unlocking {tier title}!" at render time.
  progressMessage: '',
  // Shown once this specific tier IS reached, replacing the progress
  // message above for a short celebration beat before advancing to the
  // next incomplete tier. Each tier owns its own message/confetti setting —
  // distinct from progressBar.completionMessage/confetti below, which is
  // only a fallback for the edge case of a progress bar with zero tiers.
  completionMessage: '',
  confetti: true,
};

export const defaultCartEditorState = {
  status: 'active',
  activeSection: 'design',
  previewMode: 'items',
  previewDevice: 'desktop',
  isDirty: false,
  settings: {
    design: {
      width: 'normal',
      borderRadius: 8,
      shadow: true,
      animation: 'slide',
    },
    general: {
      openOnAdd: true,
      openOnIconClick: true,
      showContinueShopping: true,
      position: 'right',
    },
  },
  header: {
    title: 'Your Cart',
    closeStyle: 'icon',
    bgColor: '#ffffff',
    textColor: '#1a1a1a',
    borderBottom: true,
  },
  body: {
    announcements: {
      enabled: false,
      text: 'Free shipping on orders over ₹999!',
      bgColor: '#4f46e5',
      textColor: '#ffffff',
      fontSize: 14,
      bold: false,
      italic: false,
      textAlign: 'center',
    },
    progressBar: {
      enabled: false,
      mode: 'amount',
      position: 'top',
      showWhenEmpty: false,
      tiers: [defaultTier],
      // Hides only the small locked-state amount pill (e.g. "₹500") under
      // each not-yet-reached milestone icon. Never affects the "You're X
      // left to reach..." progress message or the REACHED/title labels.
      hideMilestoneAmount: false,
      colors: {
        background: '#e5e7eb',
        fill: '#10b981',
        icon: '#2563eb',
        message: '#10b981',
      },
      borderRadius: 8,
      completionMessage: 'All Rewards Unlocked!',
      messageTemplate: "You're {amount} away",
      confetti: true,
    },
    couponSlider: {
      enabled: false,
      template: 'classic-banner',
      position: 'top',
      layout: 'grid',
      alignment: 'horizontal',
      singleCouponAlignment: 'left',
      showWhenEmpty: false,
      sectionTitle: 'Apply Coupon',
      titleFontSize: 14,
      titleTextAlign: 'left',
      titleColor: '#1e293b',
      selectedCoupons: [],
    },
    upsellProducts: {
      enabled: false,
      useAI: false,
      showWhenEmpty: false,
      title: 'Recommended For You',
      titleColor: '#1a1a1a',
      titleAlign: 'left',
      buttonText: 'Add',
      position: 'bottom',
      direction: 'horizontal',
      layout: 'carousel',
      limit: 3,
      showReviews: false,
      showIfInCart: false,
      manualRules: [],
    },
    countdownTimer: {
      enabled: false,
      mode: 'session',
      hours: 0,
      minutes: 15,
      label: 'Offer expires in',
      expiredLabel: 'Offer expired!',
      bgColor: '#fef2f2',
      textColor: '#991b1b',
      accentColor: '#dc2626',
      showOnProducts: true,
      showOnCoupons: true,
      couponCode: 'FLASH20',
      couponMode: 'manual',
    },
    emptyCart: {
      message: 'Your cart is empty',
      showContinueShopping: true,
      showRecommendations: true,
    },
  },
  footer: {
    checkoutButton: {
      text: 'Checkout',
      footerText: 'Shipping and taxes calculated at checkout',
      bgColor: '#000000',
      textColor: '#ffffff',
      borderRadius: 8,
      mobileButtonType: 'standard',
    },
    customCSS: '',
    watermarkEnabled: true,
  },
};

export const SECTION_GROUPS = [
  {
    title: 'Settings',
    items: [
      { id: 'design', label: 'Design', icon: 'color' },
    ],
  },
  {
    title: 'Header',
    items: [
      { id: 'header', label: 'Header Style', icon: 'layout-header' },
    ],
  },
  {
    title: 'Body',
    items: [
      { id: 'announcements', label: 'Announcements', icon: 'megaphone', toggleable: true, enabledKey: 'announcements' },
      { id: 'progressBar', label: 'Progress Bar', icon: 'chart', toggleable: true, enabledKey: 'progressBar' },
      { id: 'couponSlider', label: 'Coupon Slider', icon: 'discount', toggleable: true, enabledKey: 'couponSlider' },
      { id: 'upsellProducts', label: 'Upsell Products', icon: 'product', toggleable: true, enabledKey: 'upsellProducts' },
      { id: 'countdownTimer', label: 'Countdown Timer', icon: 'chart', toggleable: true, enabledKey: 'countdownTimer' },
      { id: 'emptyCart', label: 'Empty Cart', icon: 'cart' },
    ],
  },
  {
    title: 'Footer',
    items: [
      { id: 'checkoutButton', label: 'Checkout Button', icon: 'cash' },
      { id: 'customCSS', label: 'Custom CSS', icon: 'code' },
    ],
  },
];
