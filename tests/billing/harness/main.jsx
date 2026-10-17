import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import SubscribePage from '../../../app/routes/app.subscribe.jsx';

// The real plan page with a mock loader (window.__DATA__); its action is
// forwarded to /harness/subscribe so Playwright sees exactly what was posted.
const data = window.__DATA__ || {};
const router = createMemoryRouter([
  {
    path: '/app/subscribe',
    Component: SubscribePage,
    loader: () => data,
    action: async ({ request }) => (await fetch('/harness/subscribe', { method: 'POST', body: await request.text() })).json(),
  },
], { initialEntries: ['/app/subscribe'] });

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><RouterProvider router={router} /></AppProvider>
);
