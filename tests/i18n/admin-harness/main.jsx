import { createRoot } from 'react-dom/client';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import AccountPage from '../../../app/routes/app.additional.jsx';
import DashboardPage from '../../../app/routes/app._index.jsx';
import { I18nProvider } from '../../../app/i18n/admin.jsx';
import { pickAdminMessages, ADMIN_LANGUAGE_CHOICES, LANGUAGE_NAMES } from '../../../app/i18n/admin.shared.js';
import { PlanProvider } from '../../../app/components/PlanContext.jsx';
import { CurrencyProvider } from '../../../app/components/CurrencyContext.jsx';
import en from '../../../app/i18n/en.json';
import hi from '../../../app/i18n/locales/hi.json';
import ta from '../../../app/i18n/locales/ta.json';
import es from '../../../app/i18n/locales/es.json';
import ar from '../../../app/i18n/locales/ar.json';

// The page and language come from the URL: /?page=account&lang=hi.
const params = new URLSearchParams(location.search);
const lang = params.get('lang') || 'en';
const pageName = params.get('page') || 'account';
const messages = pickAdminMessages({ en, hi, ta, es, ar }, lang);
window.__posts = [];

// The Home loader's period, as app._index.jsx resolves it (fixed "today").
const RANGES = { today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', thisMonth: 'This month', lastMonth: 'Last month' };
const rangeFor = (preset) => {
  const id = RANGES[preset] ? preset : 'last30';
  return { preset: id, label: RANGES[id], from: '2026-10-15', to: '2026-11-13', today: '2026-11-13' };
};

const router = createMemoryRouter([
  {
    path: '/app/additional',
    Component: AccountPage,
    loader: () => ({
      shop: 'demo.myshopify.com', shopInfo: { name: 'Demo', myshopifyDomain: 'demo.myshopify.com', createdAt: '2026-01-02T00:00:00Z' },
      planKey: 'starter', subscriptionId: null, priceDisplay: { wholePrices: false },
      language: { value: lang === 'en' ? 'auto' : lang, choices: ADMIN_LANGUAGE_CHOICES.map((v) => ({ value: v, name: LANGUAGE_NAMES[v] || '' })) },
    }),
    action: async ({ request }) => {
      const form = Object.fromEntries(new URLSearchParams(await request.text()));
      window.__posts.push(form);
      return form.intent === 'language' ? { ok: true, language: form.language } : { ok: true, priceDisplay: { wholePrices: form.wholePrices === 'true' } };
    },
  },
  ...['/app/cartdrawer', '/app/bundles', '/app/cod', '/app/packs', '/app/fbt', '/app/productwidget'].map((path) => ({ path, Component: function ModuleStub() { return <div data-testid="module-page">{useLocation().pathname}</div>; } })),
  { path: '/app', Component: DashboardPage, loader: ({ request }) => ({ shop: 'demo.myshopify.com', initialAnalytics: {}, range: rangeFor(new URL(request.url).searchParams.get('range')), moduleStatus: { cart: true, combo: false, cod: true, packs: false, fbt: true, coupon: null } }) },
], { initialEntries: [pageName === 'home' ? '/app' : '/app/additional'] });

createRoot(document.getElementById('root')).render(
  <AppProvider i18n={enTranslations}>
    <I18nProvider locale={lang} messages={messages}>
      <PlanProvider plan="starter">
        <CurrencyProvider symbol="₹" code="INR" locale="en-IN">
          <RouterProvider router={router} />
        </CurrencyProvider>
      </PlanProvider>
    </I18nProvider>
  </AppProvider>
);
