import {
  HomeIcon,
  ChartVerticalIcon,
  CartIcon,
  ProductIcon,
  ImageIcon,
  DiscountIcon,
  CreditCardIcon,
  PersonIcon,
} from '@shopify/polaris-icons';

export const FEATURE_THEMES = {
  home:      { label: 'Brix',                       sub: 'Overview',          icon: HomeIcon,          from: '#4f46e5', to: '#7c3aed', accent: '#6366f1', soft: '#eef0ff' },
  analytics: { label: 'Analytics',                  sub: 'Performance',       icon: ChartVerticalIcon, from: '#1d4ed8', to: '#0ea5e9', accent: '#2563eb', soft: '#e8f0ff' },
  cart:      { label: 'Cart Editor',                sub: 'Slide-out cart',    icon: CartIcon,          from: '#6d28d9', to: '#a855f7', accent: '#7c3aed', soft: '#f3e8ff' },
  fbt:       { label: 'Frequently Bought Together', sub: 'Cross-sell widget', icon: ProductIcon,       from: '#0f766e', to: '#14b8a6', accent: '#0d9488', soft: '#e6fbf6' },
  banner:    { label: 'Coupon Banner',              sub: 'Storefront banner', icon: ImageIcon,         from: '#c2410c', to: '#f59e0b', accent: '#d97706', soft: '#fdf2e3' },
  coupon:    { label: 'Coupon Creator',             sub: 'Discount codes',    icon: DiscountIcon,      from: '#be123c', to: '#fb7185', accent: '#e11d48', soft: '#ffe9ee' },
  plans:     { label: 'Plans',                      sub: 'Pricing & billing', icon: CreditCardIcon,    from: '#6d28d9', to: '#9333ea', accent: '#7c3aed', soft: '#f3e8ff' },
  account:   { label: 'Account',                    sub: 'Store & settings',  icon: PersonIcon,        from: '#334155', to: '#64748b', accent: '#475569', soft: '#eef1f5' },
};

export function getTheme(key) {
  return FEATURE_THEMES[key] || FEATURE_THEMES.home;
}
