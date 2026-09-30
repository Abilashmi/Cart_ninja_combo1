import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { PlanProvider } from '../../../app/components/PlanContext.jsx';
import ProductWidgetPage from '../../../app/routes/app.productwidget.jsx';
import CreateDiscount from '../../../app/routes/app.discounts.create.jsx';

// Real page components with mock loaders (window.__DATA__). The page's own
// action is forwarded to fetch('/harness/productwidget-action') so Playwright
// can mock it and see exactly what was posted.
const data = window.__DATA__ || {};
const router = createMemoryRouter([
  {
    path: '/app/productwidget',
    Component: ProductWidgetPage,
    loader: () => data.page,
    action: async ({ request }) => (await fetch('/harness/productwidget-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text() })).json(),
  },
  { path: '/app/discounts/create', Component: CreateDiscount, loader: () => ({ coupons: [], shopifyDiscount: null }) },
], { initialEntries: ['/app/productwidget'] });
window.__router = router;

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><PlanProvider plan="pro"><RouterProvider router={router} /></PlanProvider></AppProvider>
);
