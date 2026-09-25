import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter, Outlet } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import AppPacks from '../../../app/routes/app.packs._index.jsx';
import NewPack from '../../../app/routes/app.packs.new.jsx';
import PackDetail from '../../../app/routes/app.packs.$id._index.jsx';
import EditPack from '../../../app/routes/app.packs.$id.edit.jsx';

// The harness renders the REAL page components with mock loaders (window.__DATA__)
// and forwards /api/packs form actions to fetch() so Playwright can mock them.
const data = window.__DATA__ || {};
const json = async (response) => response.json();

const router = createMemoryRouter([
  {
    path: '/app/packs',
    element: <Outlet />,
    children: [
      { index: true, Component: AppPacks, loader: () => data.list },
      { path: 'new', Component: NewPack, loader: () => data.builder },
      { path: ':id', element: <Outlet />, children: [
        { index: true, Component: PackDetail, loader: () => data.detail },
        { path: 'edit', Component: EditPack, loader: () => data.edit },
      ] },
    ],
  },
  { path: '/api/packs', action: async ({ request }) => json(await fetch('/api/packs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text() })) },
], { initialEntries: [window.__START__ || '/app/packs'] });
const originalNavigate = router.navigate.bind(router);
router.navigate = (...args) => { (window.__navCalls = window.__navCalls || []).push(args[0]); return originalNavigate(...args); };
window.__router = router;

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><RouterProvider router={router} /></AppProvider>
);
