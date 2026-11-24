import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import { PlanProvider } from '../../../app/components/PlanContext.jsx';
import { CurrencyProvider } from '../../../app/components/CurrencyContext.jsx';
import { CartEditorProvider } from '../../../app/context/CartEditorContext.jsx';
import { UpsellSection } from '../../../app/components/sections/UpsellSection.jsx';
import FbtPage from '../../../app/routes/app.fbt.jsx';

// Real components with mock loaders (window.__DATA__). Every action is
// forwarded to fetch('/harness/<name>') so Playwright can mock it and see
// exactly what was posted.
const data = window.__DATA__ || {};
const forward = (name) => async ({ request }) => (await fetch(`/harness/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text() })).json();

function CartUpsell() {
  return (
    <CartEditorProvider allProducts={data.allProducts || []} initialUpsellRecord={data.upsellRecord || null}>
      <div style={{ maxWidth: 420, padding: 16 }}><UpsellSection /></div>
      <RulesProbe />
    </CartEditorProvider>
  );
}
// Exposes the editor's upsell rules so the check can read what was added.
import { useCartEditor } from '../../../app/context/CartEditorContext.jsx';
function RulesProbe() {
  const { body } = useCartEditor();
  window.__upsellRules = body.upsellProducts.manualRules;
  return null;
}

const router = createMemoryRouter([
  { path: '/app/fbt', Component: FbtPage, loader: () => data.fbt, action: forward('fbt-action') },
  { path: '/app/cartdrawer', Component: CartUpsell },
  { path: '/api/pairing-assistant', action: forward('pairing-assistant') },
], { initialEntries: [data.start || '/app/fbt'] });
window.__router = router;

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}><CurrencyProvider symbol="₹" code="INR" locale="en-IN"><PlanProvider plan="pro"><RouterProvider router={router} /></PlanProvider></CurrencyProvider></AppProvider>
);
