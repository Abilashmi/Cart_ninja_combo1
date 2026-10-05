import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import Customize from '../../../app/routes/app.bundles.customize.jsx';

// The real Build a Combo builder with a layout1 template that has
// "Enable AI Suggestions for Customers" on. /api/combo-ai-suggestions is
// mocked by the Playwright runner (storefront-browser-check's sibling,
// builder-browser-check.mjs).
const img = (label) => ({ src: 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e8e1d9"/><text x="100" y="105" font-size="20" text-anchor="middle" fill="#555">${label}</text></svg>`) });
const product = (n, title, handle, price, variants = 1) => ({
  id: `gid://shopify/Product/${n}`, title, handle: `p${n}`, available: true, totalInventory: 10,
  image: img(title.split(' ')[0]), collections: [{ handle, title: handle }],
  variants: Array.from({ length: variants }, (_, i) => ({ id: `gid://shopify/ProductVariant/${n * 10 + i}`, title: variants > 1 ? `Size ${i + 1}` : 'Default Title', price, available: true, inventoryQuantity: 10 })),
});
const PRODUCTS = [
  product(1, 'Neem Face Wash', 'face-wash', '299.00'),
  product(2, 'Rose Face Wash', 'face-wash', '299.00'),
  product(3, 'Vitamin C Serum', 'serums', '699.00'),
  product(4, 'Niacinamide Serum', 'serums', '599.00', 2),
  product(5, 'SPF 50 Gel', 'sunscreen', '499.00'),
];
const byHandle = (h) => PRODUCTS.filter((p) => p.collections[0].handle === h);
const TEMPLATE = {
  id: 9, title: 'Skincare Kit', active: false, page_handle: 'kit',
  config: {
    layout: 'layout1', ai_mode: window.__AI_MODE !== false, max_products: 4, max_selections: 3,
    step_1_collection: 'face-wash', step_1_title: 'Cleanse', step_2_collection: 'serums', step_2_title: 'Treat',
    step_3_collection: 'sunscreen', step_3_title: 'Protect',
  },
};

const router = createBrowserRouter([
  {
    path: '/app/bundles/customize',
    Component: Customize,
    loader: () => ({
      initialTemplate: TEMPLATE, existingTemplates: [], activeDiscounts: [], layoutFiles: [],
      collections: [{ handle: 'face-wash', title: 'Face Wash' }, { handle: 'serums', title: 'Serums' }, { handle: 'sunscreen', title: 'Sunscreen' }],
      initialProducts: window.__EMPTY_COLLECTIONS ? PRODUCTS.map((p) => ({ ...p, collections: [{ handle: 'frontpage' }] })) : PRODUCTS,
      shop: 'demo.myshopify.com',
    }),
  },
  // window.__EMPTY_COLLECTIONS: the step collections hold no products (an
  // empty or unreachable collection) — the preview then falls back to
  // showing store products, which is what a merchant sees on screen.
  { path: '/api/products', loader: ({ request }) => Object.fromEntries((new URL(request.url).searchParams.get('handles') || '').split(',').filter(Boolean).map((h) => [h, window.__EMPTY_COLLECTIONS ? [] : byHandle(h)])) },
  { path: '/api/bundle-templates', action: async () => ({ success: true, id: 9 }) },
  { path: '/api/theme-embed-status', loader: async () => ({ checked: true, enabled: true, editorUrl: '#' }) },
]);

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><RouterProvider router={router} /></AppProvider>
);
