# Architecture

## Admin (embedded app)
- `fbt/app/routes/app.fbt.jsx`: the FBT page. Configure (Manual, AI-Powered), Styling, Bundle offer, preview, save bar.
  Reads and saves settings through `shared/app/services/cart-config-writes.server.js` (`saveFbtWidgetSettings`, merge-safe).
- `fbt/app/routes/api.fbt-settings.jsx`: settings API used by the page.
- `fbt/app/components/shared/PairingAssistant.jsx` + `api.pairing-assistant.jsx` + `services/pairing-assistant.server.js`:
  "Describe in words" / "From past orders" rule suggestions (read-only, the page adds the picked rules and the normal Save publishes them).
  This component is also used by the Cart Editor's Upsell section.

## Storefront
- Widget: `fbt/extensions/cart-drawer/assets/fbt_widget.js` / `fbt_widget_render.js` / `fbt_widget.css`, mounted by the
  `blocks/Fbt.liquid` and `FbtSection.liquid` blocks and `snippets/fbt-widget-render.liquid`. Config is fetched through the App Proxy
  (`/apps/cart-app/save_fbt_widget.php`, served by `fbt/php_backend/save_fbt_widget.php` and `app/routes/save_fbt_widget[.]php.jsx`).
- `api.fbt-widget.jsx`: widget settings API with request validation (`shared/app/validators/product-sample.validator.js`).

## Rules (one copy, shared by admin, widget and the Function)
- `utils/fbt-style.shared.js` (look, colours, layout sizes; mirrored by the widget's `normalizeConfig` / `fbtNum`).
- `utils/fbt-offer.shared.js` (bundle offer text, savings; mirrored by the widget's `offerSavings`).
- `utils/fbt-size.shared.js` (match the shopper's size; ES5 copy in `fbt_widget_render.js`).
- `utils/fbt-ai.shared.js` (AI pairing), `utils/pairing.shared.js` (rule keys, plan matching, rule building).

## Bundle offer at checkout
- `services/fbt-offer-shopify.server.js` (`syncFbtOfferDiscount`): writes the app metafield `$app:fbt_offer_config`, ensures the automatic
  discount "BRIX Bundle Offer", and reports a state (`active`, `show_only`, ...). Runs on every FBT save.
- Shopify Function `shopify-functions` = `fbt/extensions/brix-fbt-discount` (PRODUCT class, trusts only that metafield; skips reward, pack and combo lines).

## Tests
`fbt/tests/fbt-offer/` (shared rules, Function logic, sync with fakes, widget browser check), `fbt/tests/pairing/`
(pairing rules, server, Vite harness browser check), `fbt/tests/ai-handoff/fbt-ai.shared.test.mjs`,
`fbt/tests/coupon-banner/timer-and-fbt-browser-check.mjs` (mixed with the coupon timer), `fbt/tests/pages` + `fbt/tests/specs` (Playwright).

FBT does not import the Bundle or Packs modules.
