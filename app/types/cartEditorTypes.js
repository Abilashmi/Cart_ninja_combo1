// Cart Editor Type Definitions

export const defaultTier = {
  id: 'tier-1',
  minimumSpend: 500,
  title: 'First Reward',
  description: 'Unlock your first milestone reward',
  icon: 'gift',
  rewardProducts: [],
  rewardProductCount: 0,
};

export const defaultCartEditorState = {
  status: 'active',
  activeSection: 'general',
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
    },
    progressBar: {
      enabled: false,
      mode: 'amount',
      position: 'top',
      showWhenEmpty: false,
      tiers: [defaultTier],
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
      { id: 'general', label: 'General', icon: 'settings' },
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
