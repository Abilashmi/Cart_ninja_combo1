/* Brix checkout router — hands checkout to Shiprocket Checkout (Fastrr) on
 * shops where our backend has switched it on (php_backend/integrations_admin.php),
 * and to GoKwik's Kwik Checkout on shops with its app embed (checkoutGoKwik).
 *
 * Callers (cart_drawer_inline.js, the app-served combo-page.js) only call in
 * here when that per-shop switch is on; every other shop keeps navigating to
 * Shopify's /checkout exactly as before and never touches this file's logic.
 *
 * Why this exists: Shiprocket's theme script only hooks the theme's own
 * `button[name="checkout"]` / `a[href="/checkout"]` elements, and reads the
 * coupon from the `discount_code` cookie — it never sees a button that
 * navigates by script, or a `?discount=` URL param. So we call its public
 * entry points (window.shiprocketCheckoutEvents) directly instead.
 *
 * Every path falls back to `fallbackUrl` (the normal Shopify checkout URL the
 * caller would have used anyway), so a shopper is never left stuck.
 */
(function () {
  'use strict';
  if (window.BrixCheckout) return;

  // Shiprocket's script is loaded `defer` by the theme, so it can still be on
  // its way when a fast shopper taps checkout.
  var SR_WAIT_MS = 1500;
  // If Shiprocket's popup hasn't appeared by then, stop waiting and use Shopify.
  var SR_OPEN_TIMEOUT_MS = 8000;
  var COUPON_KEY = 'brix_sr_coupon';

  var busy = false; // one checkout action per tap, across every caller

  function rootUrl() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  }

  function go(url) {
    busy = false;
    window.location.href = url;
  }

  function shiprocketEvents() {
    var events = window.shiprocketCheckoutEvents;
    return events && typeof events.buyCart === 'function' ? events : null;
  }

  function waitForShiprocket() {
    return new Promise(function (resolve) {
      var started = Date.now();
      (function check() {
        var events = shiprocketEvents();
        if (events || Date.now() - started >= SR_WAIT_MS) { resolve(events); return; }
        setTimeout(check, 100);
      })();
    });
  }

  // Elements Shiprocket adds to the page once its checkout is opening.
  function popupOpen() {
    return Boolean(document.querySelector('#fastrr-main-container, #headless-container, #fastrr-pre-loader'));
  }

  function readCookie(name) {
    var parts = ('; ' + document.cookie).split('; ' + name + '=');
    if (parts.length < 2) return null;
    var raw = parts.pop().split(';')[0];
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  function remember(code) {
    try {
      if (code) window.sessionStorage.setItem(COUPON_KEY, code);
      else window.sessionStorage.removeItem(COUPON_KEY);
    } catch (e) { /* storage blocked — only costs the stale-cookie cleanup below */ }
  }

  function remembered() {
    try { return window.sessionStorage.getItem(COUPON_KEY); } catch (e) { return null; }
  }

  // Shiprocket's cart checkout takes its coupon from the `discount_code`
  // cookie: written here at once. Shopify's own /discount/<code> (which also
  // puts the code on its cart, for the Shopify checkout fallback) runs
  // alongside; waiting for it held Shiprocket back ~1.4 s.
  function syncCoupon(code) {
    if (code) {
      var url = rootUrl() + 'discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(rootUrl() + 'cart.js');
      document.cookie = 'discount_code=' + encodeURIComponent(code) + '; path=/';
      remember(code);
      window.fetch(url, { credentials: 'same-origin' }).catch(function () { return null; });
      return Promise.resolve();
    }
    // No coupon applied now: drop only a code this helper set earlier (the
    // shopper applied then removed it). A cookie from the merchant's own
    // discount link is left alone.
    var ours = remembered();
    if (ours) {
      if (readCookie('discount_code') === ours) document.cookie = 'discount_code=; Max-Age=0; path=/';
      remember(null);
    }
    return Promise.resolve();
  }

  // Pack prices, weight combo box prices and free reward gifts are applied by
  // our Shopify Functions, which only run in Shopify's own checkout —
  // Shiprocket would charge those lines at full price. A cart holding any of
  // them stays on Shopify checkout, except free gifts the one-time code
  // already covers (giftsCovered, brix_cod.js prepaidCartCode). If the cart
  // can't be read, stay on Shopify too.
  function cartNeedsShopifyCheckout(giftsCovered) {
    return window.fetch(rootUrl() + 'cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (response) { return response.json(); })
      .then(function (cart) {
        return (cart.items || []).some(function (item) {
          var properties = item.properties || {};
          if (properties._brix_pack_id || properties._brix_combo_id) return true;
          return !giftsCovered && properties._brixReward === 'true' && Number(item.final_line_price) === 0;
        });
      })
      .catch(function () { return true; });
  }

  // Calls into Shiprocket, then watches for its popup. Shiprocket has its own
  // redirect-to-fallback on a failed start; the timeout only covers it doing
  // nothing at all.
  function launch(open, fallbackUrl, onOpen) {
    try { open(); } catch (e) { go(fallbackUrl); return; }
    var started = Date.now();
    var timer = setInterval(function () {
      if (popupOpen()) {
        clearInterval(timer);
        busy = false;
        if (typeof onOpen === 'function') { try { onOpen(); } catch (e) { /* caller's UI cleanup must not affect checkout */ } }
        return;
      }
      if (Date.now() - started >= SR_OPEN_TIMEOUT_MS) {
        clearInterval(timer);
        go(fallbackUrl);
      }
    }, 100);
  }

  // Checks out the whole current cart (the cart drawer's checkout button).
  // options: { coupon, giftsCovered, fallbackUrl, onOpen }
  function checkoutCart(options) {
    var fallbackUrl = (options && options.fallbackUrl) || rootUrl() + 'checkout';
    if (busy) return;
    busy = true;
    waitForShiprocket()
      .then(function (events) {
        if (!events) { go(fallbackUrl); return null; }
        // giftsCovered only counts with the code that covers them.
        var giftsCovered = Boolean(options && options.giftsCovered && options.coupon);
        return Promise.all([cartNeedsShopifyCheckout(giftsCovered), syncCoupon(options && options.coupon)]).then(function (results) {
          if (results[0]) { go(fallbackUrl); return; }
          launch(function () { events.buyCart(null); }, fallbackUrl, options && options.onOpen);
        });
      })
      .catch(function () { go(fallbackUrl); });
  }

  // Checks out exactly the given items without touching the shopper's cart
  // (combo pages) — Shiprocket's equivalent of a /cart/<variant>:<qty> link.
  // options: { items: [{ variantId, quantity }], coupon, attributes, fallbackUrl, onOpen }
  function checkoutItems(options) {
    var fallbackUrl = options.fallbackUrl;
    if (busy) return;
    busy = true;
    waitForShiprocket()
      .then(function (events) {
        if (!events || typeof events.buyDirect !== 'function') { go(fallbackUrl); return; }
        launch(function () {
          events.buyDirect({
            type: 'cart',
            products: options.items,
            couponCode: options.coupon || null,
            cartAttributes: options.attributes || null,
            fallbackUrl: fallbackUrl,
          });
        }, fallbackUrl, options.onOpen);
      })
      .catch(function () { go(fallbackUrl); });
  }

  /* GoKwik (Kwik COD Checkout app embed, e.g. fabimore.com): its
     gokwik-sso-sdk.js defines window.initiateLogin(), which opens GoKwik's
     checkout for the cart in /cart.js with the coupon from the
     `discount_code` cookie. GoKwik only re-wires the theme's own drawer
     buttons, so the BRIX drawer's Checkout went to Shopify's /checkout. The
     embed sets window.gkShopDomain at once; the SDK itself loads `defer`. */
  function goKwikReady() {
    return typeof window.initiateLogin === 'function' && !window.gkSdkNotRequired;
  }
  function hasGoKwik() {
    return !window.gkSdkNotRequired && (goKwikReady() || Boolean(window.gkShopDomain));
  }
  function waitForGoKwik() {
    return new Promise(function (resolve) {
      var started = Date.now();
      (function check() {
        if (goKwikReady() || Date.now() - started >= SR_WAIT_MS) { resolve(goKwikReady()); return; }
        setTimeout(check, 100);
      })();
    });
  }

  // Checks out the whole cart in GoKwik. Same rule as Shiprocket: Pack /
  // combo box lines and ₹0 free gifts are priced by our Shopify Functions, so
  // those carts stay on Shopify checkout. GoKwik falls back to /checkout itself
  // when it can't start. options: { coupon, fallbackUrl, onOpen }
  function checkoutGoKwik(options) {
    var fallbackUrl = (options && options.fallbackUrl) || rootUrl() + 'checkout';
    if (busy) return;
    busy = true;
    waitForGoKwik()
      .then(function (ready) {
        if (!ready) { go(fallbackUrl); return null; }
        return Promise.all([cartNeedsShopifyCheckout(false), syncCoupon(options && options.coupon)]).then(function (results) {
          if (results[0]) { go(fallbackUrl); return; }
          busy = false;
          // Our drawer closes first; GoKwik's popup then locks the page scroll.
          if (options && typeof options.onOpen === 'function') { try { options.onOpen(); } catch (e) { /* UI cleanup only */ } }
          try { window.initiateLogin(); } catch (e) { go(fallbackUrl); }
        });
      })
      .catch(function () { go(fallbackUrl); });
  }

  // Shiprocket's checkout is on this page (loaded, or its script tag is there
  // and still loading). fabimore.com has BRIX's Shiprocket switch on but runs
  // GoKwik: waiting for a Shiprocket that never came sent it to Shopify.
  function shiprocketOnPage() {
    return Boolean(shiprocketEvents() || document.querySelector('script[src*="fastrr"], script[src*="pickrr"], script[src*="shiprocket"]'));
  }

  // Which checkout the cart drawer hands over to: 'shiprocket' (BRIX's switch
  // on and its script on the page), 'gokwik' (GoKwik's embed on, no
  // Shiprocket), 'shiprocket' still when the switch is on and neither shows
  // (it may load late; that path falls back to Shopify), else 'shopify'.
  function cartCheckoutVia(shiprocketSwitch) {
    if (shiprocketSwitch && shiprocketOnPage()) return 'shiprocket';
    if (hasGoKwik()) return 'gokwik';
    return shiprocketSwitch ? 'shiprocket' : 'shopify';
  }

  window.BrixCheckout = { checkoutCart: checkoutCart, checkoutItems: checkoutItems, hasGoKwik: hasGoKwik, checkoutGoKwik: checkoutGoKwik, cartCheckoutVia: cartCheckoutVia };
})();
