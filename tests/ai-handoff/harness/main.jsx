import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import BrixAiPage from '../../../app/components/ai-agent/BrixAiPage.jsx';
import BrixBar from '../../../app/components/ai-agent/BrixBar.jsx';
import CartEditorPage from '../../../app/components/CartEditorPage.jsx';
import { HANDOFF_RECEIVED_EVENT } from '../../../app/utils/ai-handoff.js';
import Customize from '../../../app/routes/app.bundles.customize.jsx';
import BundlesDashboard from '../../../app/routes/app.bundles._index.jsx';
import FbtPage from '../../../app/routes/app.fbt.jsx';
import CartDrawerEmbedBanner from '../../../app/components/bundles/CartDrawerEmbedBanner.jsx';
import { cartDrawerEmbedEditorUrl } from '../../../app/config/theme-extension.js';

// Real BrixAiPage, real BrixBar, real CartEditorPage (sidebar + accordion).
// FBT / Build a Combo pages are stubs that host only the real BrixBar — their
// route files pull in server modules and thousands of lines of unrelated UI.
window.__handoffEvents = [];
window.addEventListener(HANDOFF_RECEIVED_EVENT, (e) => window.__handoffEvents.push(e.detail));

const BarPage = ({ title }) => (
  <div style={{ padding: 24 }}>
    <h1 data-testid="page-title">{title}</h1>
    <BrixBar size="md" floating />
  </div>
);

// The real embed banner, as the Build a Combo page renders it when the embed is off.
const BannerPage = () => (
  <div style={{ padding: 24, maxWidth: 900 }}>
    <CartDrawerEmbedBanner
      editorUrl={cartDrawerEmbedEditorUrl('demo.myshopify.com')}
      onCheckAgain={() => { window.__checkAgain = (window.__checkAgain || 0) + 1; }}
    />
  </div>
);

// The real Build a Combo builder, with mocked loader and mocked API endpoints.
// window.__EMBED_STATUS (set per test) is what /api/theme-embed-status returns.
const svgImage = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${c}"/></svg>`);
const TEMPLATE = { id: 5, title: 'My combo', active: false, page_handle: 'my-combo', config: { layout: 'layout2' } };
window.__saves = [];

const router = createBrowserRouter([
  { path: '/__embed-banner', element: <BannerPage /> },
  {
    path: '/app/bundles/customize',
    Component: Customize,
    loader: () => ({ initialTemplate: window.__NO_TEMPLATE ? null : TEMPLATE, existingTemplates: [], activeDiscounts: [], layoutFiles: [], collections: [], initialProducts: [], shop: 'demo.myshopify.com' }),
  },
  { path: '/app/bundles/templates', element: <div data-testid="templates-list">Templates list</div> },
  {
    path: '/api/bundle-templates',
    action: async () => { window.__saves.push(Date.now()); return { success: true, message: 'Template updated', id: 5 }; },
  },
  {
    path: '/api/theme-embed-status',
    loader: async () => {
      const delay = window.__EMBED_DELAY || 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return window.__EMBED_STATUS ?? { checked: true, enabled: true, editorUrl: 'https://demo.myshopify.com/admin/themes/current/editor?context=apps' };
    },
  },
  { path: '/app/brix-ai', Component: BrixAiPage },
  { path: '/app/cartdrawer', Component: CartEditorPage, loader: () => ({}) },
  // Cart Editor with a Progress Bar milestone whose reward is a product, plus an upsell list
  // to "add" from. window.__PB_PRICING = 'free' | 'regular' picks the reward price.
  {
    path: '/app/cartdrawer-preview',
    Component: CartEditorPage,
    loader: () => ({
      allProducts: [
        { id: 'gid://shopify/Product/1', title: 'Yoga Mat Pro', price: '250', image: svgImage('#a78bfa') },
        { id: 'gid://shopify/Product/2', title: 'Travel Towel', price: '40', image: '' },
        { id: 'gid://shopify/Product/3', title: 'Water Bottle With A Very Long Product Name For Wrapping', price: '90', image: svgImage('#34d399') },
        { id: 'gid://shopify/Product/4', title: 'Gift Card', price: '10', image: svgImage('#fb923c') },
      ],
      pbRecord: {
        id: 1, is_enabled: 1, mode: 'amount', show_on_empty: 1, placement: 'top',
        tiers: [{ id: 11, min_value: 600, min_quantity: 0, description: 'Free towel', reward_type: 'free_shipping', icon_preset: 'gift', reward_products: ['gid://shopify/Product/2'], reward_pricing: window.__PB_PRICING || 'free' }],
      },
      upsellRecord: { is_enabled: 1, title: 'Add-ons', layout: 'list', button_text: 'Add', position: 'bottom', display_limit: 2, show_price: 1, manual_rules: [] },
    }),
  },
  { path: '/app/fbt', element: <BarPage title="FBT" /> },
  // The real FBT page (with its setup tour), mocked loader.
  {
    path: '/app/fbt-real',
    Component: FbtPage,
    loader: () => ({ shop: window.__SHOP || 'demo.myshopify.com', fbtConfig: { activeTemplate: 'fbt1', mode: 'manual', layout: 'horizontal' }, allProducts: [{ id: 'gid://shopify/Product/1', title: 'Yoga Mat', price: '25', image: '' }], manualRules: [], fbtEmbedEnabled: true, hasSavedFbtConfig: false }),
  },
  { path: '/app/bundles', element: <BarPage title="Build a Combo" /> },
  // The real Build a Combo dashboard (with the setup tour), mocked loader.
  {
    path: '/app/bundles-real',
    Component: BundlesDashboard,
    loader: () => ({ templateCount: 0, publishedCount: 0, publishedPages: [], templates: window.__TEMPLATES || [], shop: 'demo.myshopify.com', discounts: [], totalConversions: 0, totalRevenue: 0, showEmbedWarning: false, embedEditorUrl: '#' }),
  },
  { path: '/app/productwidget', element: <BarPage title="Coupon Banner" /> },
  { path: '/app/analytics', element: <BarPage title="Analytics" /> },
]);
window.__router = router;

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><RouterProvider router={router} /></AppProvider>
);
