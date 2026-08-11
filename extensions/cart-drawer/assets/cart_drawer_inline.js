(function () {
  console.log('[CartDrawer] Script loaded ✓');

  // Debug logging behind an explicit flag — enable via
  // window.__CC_DEBUG__ = true, window.CartNinjaDebug = true, or
  // ?cc_debug=1 in the URL. Silent by default so this never spams
  // merchant/customer consoles.
  var CC_DEBUG = window.__CC_DEBUG__ === true || window.CartNinjaDebug === true || /(?:^|[?&])cc_debug=1(?:&|$)/.test(location.search);
  function ccDebug() {
    if (!CC_DEBUG) return;
    console.log.apply(console, ['[CartDrawer debug]'].concat(Array.prototype.slice.call(arguments)));
  }
  // Coarser, milestone-level logging for the native-drawer-suppression
  // lifecycle specifically (Add-to-cart detected / Native cart detected /
  // Native drawer suppressed / etc.) — same on/off flag as ccDebug, just a
  // distinct prefix so these specific checkpoints are easy to grep for
  // separately from the more granular play-by-play ccDebug lines.
  function ccMilestone() {
    if (!CC_DEBUG) return;
    console.log.apply(console, ['[CART-NINJA]'].concat(Array.prototype.slice.call(arguments)));
  }
  // Counts every /cart/add(.js) request seen within a short window of a
  // single user action (ours or anyone else's, via the fetch/XHR patches
  // and our own explicit calls) so we can log exactly how many requests one
  // click produced — the clearest possible signal for "is this doubling."
  let _ccAddRequestCount = 0;
  let _ccAddRequestLogTimer = null;
  function ccCountAddRequest(source) {
    _ccAddRequestCount++;
    ccDebug('add-request counter: +1 from', source, '— running total for this action:', _ccAddRequestCount);
    if (_ccAddRequestLogTimer) clearTimeout(_ccAddRequestLogTimer);
    _ccAddRequestLogTimer = setTimeout(function () {
      ccMilestone('Total /cart/add.js requests for this action:', _ccAddRequestCount);
      _ccAddRequestCount = 0;
      _ccAddRequestLogTimer = null;
    }, 1500);
  }

  const container = document.getElementById('cc-root');
  if (!container) return;

  // Idempotent boot guard — the theme editor / dynamic section rendering can
  // re-insert this <script> tag (which re-executes it) without a full page
  // reload. Without this guard, every delegated listener below (submit,
  // click, fetch/XHR patches, MutationObservers) would be registered a
  // second time, and since browsers only fully suppress SAME-node listeners
  // via stopImmediatePropagation, a duplicate submit listener would double
  // the /cart/add.js POST on every Add to Cart click.
  //
  // Placed AFTER the #cc-root check so a genuinely-first init that happens
  // to run before the container exists doesn't permanently latch the guard
  // and block a real later init.
  //
  // This only skips *registration* of the delegated listeners — it does not
  // need to "rebind" anything for content, because everything below is
  // delegated on document/window, so newly-rendered DOM (new product forms,
  // new buttons) is automatically covered by the listeners already
  // registered on the first boot. The one exception is
  // ccWatchCartCount(), which attaches a MutationObserver per matched
  // element at call time — that's re-invoked separately on
  // shopify:section:load (see below), independent of this guard, and is
  // safe to call repeatedly since it self-guards via el._ccWatching.
  if (window.__CC_BOOTED__) {
    ccDebug('boot guard: already booted, skipping re-init (script re-executed)');
    if (typeof window.__CC_REBIND__ === 'function') window.__CC_REBIND__();
    return;
  }
  window.__CC_BOOTED__ = true;
  ccDebug('boot guard: first boot, initializing');

  const SHOP = container.getAttribute('data-shop');
  const CURRENCY_CODE = container.getAttribute('data-currency') || 'USD';
  const API_BASE = '/apps/cart-app';
  const CONFIG_API = API_BASE + '/save_cart_drawer.php?shopdomain=' + SHOP;
  const COUPON_API = API_BASE + '/save_coupon.php?shopdomain=' + SHOP;
  const CLICK_API = API_BASE + '/click.php';
  const SESSION_API = API_BASE + '/session_ping.php';

  // Client-generated session id (30-min rolling expiry) — visitor/session
  // approximation for the analytics module. Not a substitute for a real
  // consent-gated analytics pixel; see analytics plan decision D3.
  function ccGetOrCreateSessionId() {
    try {
      var idKey = 'cc_session_id';
      var expiryKey = 'cc_session_expiry';
      var now = Date.now();
      var existing = localStorage.getItem(idKey);
      var expiry = parseInt(localStorage.getItem(expiryKey) || '0', 10);
      if (existing && expiry > now) {
        localStorage.setItem(expiryKey, String(now + 30 * 60 * 1000));
        return existing;
      }
      var id = 'sess_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(idKey, id);
      localStorage.setItem(expiryKey, String(now + 30 * 60 * 1000));
      return id;
    } catch (e) {
      return 'sess_' + Date.now().toString(36);
    }
  }

  const CC_SESSION_ID = ccGetOrCreateSessionId();

  // Utility: Get currency symbol from code
  function getCurrencySymbol(code) {
    const symbols = {
      USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AUD: 'A$', CAD: 'C$',
      CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$', MXN: '$', SGD: 'S$', HKD: 'HK$',
      NOK: 'kr', KRW: '₩', TRY: '₺', RUB: '₽', BRL: 'R$', ZAR: 'R', THB: '฿',
      MYR: 'RM', PHP: '₱', IDR: 'Rp', VND: '₫', KES: 'KSh', NGN: '₦', PKR: '₨',
      BDT: '৳', AED: 'د.إ', SAR: '﷼', QAR: '﷼'
    };
    return symbols[code] || code;
  }

  const CURRENCY_SYMBOL = getCurrencySymbol(CURRENCY_CODE);

  // Inline SVG paths matching Polaris icons used in the admin preview
  const CC_ICON_PATHS = {
    discount: '<path d="M3.25 5.5c0-1.242 1.007-2.25 2.25-2.25.414 0 .75.336.75.75s-.336.75-.75.75-.75.336-.75.75-.336.75-.75.75-.75-.336-.75-.75Z"/><path d="M12.78 7.22c.293.293.293.768 0 1.06l-4.5 4.5c-.293.293-.767.293-1.06 0-.293-.292-.293-.767 0-1.06l4.5-4.5c.293-.293.767-.293 1.06 0Z"/><path d="M9 8c0 .553-.448 1-1 1s-1-.447-1-1c0-.552.448-1 1-1s1 .448 1 1Z"/><path d="M12 13c.552 0 1-.447 1-1 0-.552-.448-1-1-1s-1 .448-1 1c0 .553.448 1 1 1Z"/><path d="M3.25 14.5c0 1.243 1.007 2.25 2.25 2.25.414 0 .75-.335.75-.75 0-.414-.336-.75-.75-.75s-.75-.335-.75-.75c0-.414-.336-.75-.75-.75s-.75.336-.75.75Z"/><path d="M16.75 14.5c0 1.243-1.007 2.25-2.25 2.25-.414 0-.75-.335-.75-.75 0-.414.336-.75.75-.75s.75-.335.75-.75c0-.414.336-.75.75-.75s.75.336.75.75Z"/><path d="M16.75 5.5c0-1.242-1.007-2.25-2.25-2.25-.414 0-.75.336-.75.75s.336.75.75.75.75.336.75.75.336.75.75.75.75-.336.75-.75Z"/><path d="M16 8.25c.414 0 .75.336.75.75v2c0 .415-.336.75-.75.75s-.75-.335-.75-.75v-2c0-.414.336-.75.75-.75Z"/><path d="M11 16.75c.414 0 .75-.335.75-.75 0-.414-.336-.75-.75-.75h-2c-.414 0-.75.336-.75.75 0 .415.336.75.75.75h2Z"/><path d="M4 8.25c.414 0 .75.336.75.75v2c0 .415-.336.75-.75.75s-.75-.335-.75-.75v-2c0-.414.336-.75.75-.75Z"/><path d="M11 4.75c.414 0 .75-.336.75-.75s-.336-.75-.75-.75h-2c-.414 0-.75.336-.75.75s.336.75.75.75h2Z"/>',
    gift: '<path d="M7.835 9.5h-.96c-.343 0-.625-.28-.625-.628 0-.344.28-.622.619-.622.242 0 .463.142.563.363l.403.887Z"/><path d="M10.665 9.5h.96c.343 0 .625-.28.625-.628 0-.344-.28-.622-.619-.622-.242 0-.463.142-.563.363l-.403.887Z"/><path fill-rule="evenodd" d="M8.5 4h-3.25c-1.519 0-2.75 1.231-2.75 2.75v2.25h1.25c.414 0 .75.336.75.75s-.336.75-.75.75h-1.25v2.75c0 1.519 1.231 2.75 2.75 2.75h3.441c-.119-.133-.191-.308-.191-.5v-2c0-.414.336-.75.75-.75s.75.336.75.75v2c0 .192-.072.367-.191.5h4.941c1.519 0 2.75-1.231 2.75-2.75v-2.75h-2.75c-.414 0-.75-.336-.75-.75s.336-.75.75-.75h2.75v-2.25c0-1.519-1.231-2.75-2.75-2.75h-4.75v2.25c0 .414-.336.75-.75.75s-.75-.336-.75-.75v-2.25Zm.297 3.992c-.343-.756-1.097-1.242-1.928-1.242-1.173 0-2.119.954-2.119 2.122 0 1.171.95 2.128 2.125 2.128h.858c-.595.51-1.256.924-1.84 1.008-.41.058-.694.438-.635.848.058.41.438.695.848.636 1.11-.158 2.128-.919 2.803-1.53.121-.11.235-.217.341-.322.106.105.22.213.34.322.676.611 1.693 1.372 2.804 1.53.41.059.79-.226.848-.636.059-.41-.226-.79-.636-.848-.583-.084-1.244-.498-1.839-1.008h.858c1.176 0 2.125-.957 2.125-2.128 0-1.168-.946-2.122-2.119-2.122-.83 0-1.585.486-1.928 1.242l-.453.996-.453-.996Z"/>',
    shipping: '<path fill-rule="evenodd" d="M4.75 4.5a.75.75 0 0 0 0 1.5h3.25a1 1 0 0 1 0 2h-4.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 0 0 1.5h.458a2.5 2.5 0 1 0 4.78.75h3.024a2.5 2.5 0 1 0 4.955-.153 1.75 1.75 0 0 0 1.033-1.597v-1.22a1.75 1.75 0 0 0-1.326-1.697l-1.682-.42a.25.25 0 0 1-.18-.174l-.426-1.494a2.75 2.75 0 0 0-2.645-1.995h-6.991Zm2.75 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
    star: '<path d="M11.128 4.123c-.453-.95-1.803-.95-2.256 0l-1.39 2.912-3.199.421c-1.042.138-1.46 1.422-.697 2.146l2.34 2.222-.587 3.172c-.192 1.034.901 1.828 1.825 1.327l2.836-1.54 2.836 1.54c.924.501 2.017-.293 1.825-1.327l-.587-3.172 2.34-2.222c.762-.724.345-2.008-.697-2.146l-3.2-.421-1.389-2.912Z"/>',
    percent: '<path fill-rule="evenodd" d="M11.527 3.327c-.6-1.306-2.455-1.306-3.054 0a1.68 1.68 0 0 1-2.112.874c-1.347-.5-2.66.813-2.16 2.16a1.68 1.68 0 0 1-.874 2.112c-1.306.6-1.306 2.455 0 3.054a1.68 1.68 0 0 1 .874 2.112c-.5 1.347.813 2.659 2.16 2.16a1.68 1.68 0 0 1 2.112.874c.6 1.306 2.455 1.306 3.054 0a1.68 1.68 0 0 1 2.112-.874c1.347.499 2.66-.813 2.16-2.16a1.68 1.68 0 0 1 .874-2.112c1.306-.6 1.306-2.455 0-3.054a1.68 1.68 0 0 1-.874-2.112c.5-1.347-.813-2.66-2.16-2.16a1.68 1.68 0 0 1-2.112-.874Zm-2.527 4.923a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3.53.53-4 4a.75.75 0 1 1-1.06-1.06l4-4a.75.75 0 1 1 1.06 1.06Zm.47 3.47a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>',
    cash: '<path d="M9.5 6.5a.75.75 0 0 1 1.5 0v.25h.75a.75.75 0 0 1 0 1.5h-2.25a.5.5 0 0 0 0 1h1a2 2 0 1 1 0 4v.25a.75.75 0 0 1-1.5 0v-.25h-.75a.75.75 0 0 1 0-1.5h2.25a.5.5 0 0 0 0-1h-1a2 2 0 1 1 0-4v-.25Z"/><path fill-rule="evenodd" d="M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-1.5 0a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z"/>',
  };
  function ccIconSvg(key, size, color) {
    const paths = CC_ICON_PATHS[key] || CC_ICON_PATHS.discount;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="' + size + '" height="' + size + '" fill="' + color + '" style="display:block;flex-shrink:0;">' + paths + '</svg>';
  }

  let CONFIG = null;
  let COUPONS = [];
  let appliedCouponCodes = [];
  let _lastCopiedCode = null;
  let _ccConfigLoading = false;
  let _ccActive = false; // true only when drawer is fully configured and active
  let _ccCountdownInterval = null;
  // Timestamp of the most recent /cart/add call NOT made by us (i.e. seen
  // via the window.fetch/XHR monkeypatches below, which only observe calls
  // that go through the wrapped globals — our own add calls always use
  // originalFetch directly and never touch these). Some themes are built on
  // a component framework with a single global delegated 'submit' listener
  // registered on document; if that listener happens to be registered
  // before ours (same node, same capture phase — same-node listeners fire
  // in registration order regardless of stopImmediatePropagation, which
  // only stops listeners registered AFTER the one that called it), the
  // theme's own AJAX add-to-cart runs first, synchronously, before our
  // submit interceptor's code even starts — so by the time we check this
  // timestamp it's already been set, letting us skip our own duplicate
  // POST instead of adding the item a second time.
  let _ccExternalAddInFlightAt = 0;
  // Add-to-cart transaction guard — a rapid double-click can fire two
  // separate, individually-legitimate 'submit' events before the theme has
  // a chance to disable the button, each of which would otherwise pass our
  // per-event checks (defaultPrevented/_ccExternalAddInFlightAt) cleanly
  // and produce two real POSTs. This flag makes the second submission, if
  // it arrives while the first is still in flight, a no-op instead —
  // prevented from navigating, but not re-added. Auto-resets on success,
  // failure, AND a hard timeout safety net, so a hung request can never
  // permanently block later, legitimate Add to Cart clicks.
  let _ccAddToCartInFlight = false;
  let _ccAddToCartInFlightSafetyTimer = null;
  function ccBeginAddToCartTransaction() {
    _ccAddToCartInFlight = true;
    if (_ccAddToCartInFlightSafetyTimer) clearTimeout(_ccAddToCartInFlightSafetyTimer);
    _ccAddToCartInFlightSafetyTimer = setTimeout(ccEndAddToCartTransaction, 8000);
  }
  function ccEndAddToCartTransaction() {
    _ccAddToCartInFlight = false;
    if (_ccAddToCartInFlightSafetyTimer) { clearTimeout(_ccAddToCartInFlightSafetyTimer); _ccAddToCartInFlightSafetyTimer = null; }
  }


  const CC_STORE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
  let _ccStoreCatalogCache = { ts: 0, candidateCatalog: [], detailsById: {} };
  let _ccStoreCatalogPromise = null;
  let _ccRewardSyncInFlight = false;

  /* =================== CONFETTI POPUP =================== */
  function triggerConfetti() {
    setTimeout(() => {
      const drawer = document.getElementById('cc-drawer');
      if (!drawer) return;

      let canvas = document.getElementById('cc-confetti-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'cc-confetti-canvas';
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '100'; // High enough to be over items but maybe under overlay text? Actually 100 is safe.
        drawer.appendChild(canvas);
      }

      const runConfetti = () => {
        const myConfetti = window.confetti.create(canvas, { resize: true, useWorker: true });
        // Double burst from right-side corners
        myConfetti({
          particleCount: 100,
          spread: 60,
          origin: { x: 1, y: 0.2 }, // Top right area
          colors: ['#2563eb', '#10b981', '#f59e0b']
        });
        myConfetti({
          particleCount: 100,
          spread: 60,
          origin: { x: 1, y: 0.8 }, // Bottom right area
          colors: ['#ef4444', '#8b5cf6', '#10b981']
        }).then(() => {
          // Clean up canvas after a few seconds
          setTimeout(() => {
            if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
          }, 3000);
          window._ccConfettiShown = false;
        });
      };

      if (window.confetti) {
        runConfetti();
      } else {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js';
        script.onload = runConfetti;
        document.head.appendChild(script);
      }
    }, 500); // 500ms delay for a responsive confetti burst
  }

  /* =================== LOAD CONFIG =================== */

  async function loadConfig() {
    _ccConfigLoading = true;
    try {
      const fetchOptions = {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
      };

      const [configRes, couponRes] = await Promise.all([
        window.fetch(CONFIG_API, fetchOptions),
        window.fetch(COUPON_API, fetchOptions).catch(() => null),
      ]);

      if (!configRes || !configRes.ok) {
        throw new Error('Config API request failed');
      }

      const configJson = await configRes.json();

      if (configJson.status === 'success' && configJson.data) {
        const d = configJson.data;

        const cartActive =
          isEnabled(d.cartStatus) || isEnabled(d.cart_status) ||
          isEnabled(d.cartstatus) || isEnabled(d.status);

        if (!cartActive) {
          CONFIG = null;
          _ccActive = false;
          return;
        }

        CONFIG = {
          cartStatus: true,
          progress: parseProgressData(d),
          coupon: parseCouponData(d),
          upsell: parseUpsellData(d),
          checkoutButtonStyle: parseCheckoutButtonStyle(d),
          checkoutName: d.checkoutName || 'Checkout Now',
          checkoutFooterText: d.checkoutFooterText || 'Shipping and taxes calculated at checkout',
          // Server (php_backend/save_cart_drawer.php) already intersects this
          // with the shop's plan — Free always sends true regardless of the
          // merchant's toggle. Default true here too so a fetch hiccup never
          // silently drops the badge.
          showWatermark: d.showWatermark !== false,
          announcement: {
            enabled: isEnabled(d.announcement_enabled),
            text: d.announcement_text || '',
            bgColor: d.announcement_bg_color || '#4f46e5',
            textColor: d.announcement_text_color || '#ffffff',
            fontSize: parseInt(d.announcement_font_size || 14, 10),
            bold: isEnabled(d.announcement_bold),
            italic: isEnabled(d.announcement_italic),
            textAlign: d.announcement_text_align || 'center',
          },
          header: {
            title: d.header_title || 'Your Cart',
            bgColor: d.header_bg_color || '#f9fafb',
            textColor: d.header_text_color || '#000000',
            borderBottom: d.header_border_bottom != null ? isEnabled(d.header_border_bottom) : true,
          },
          design: {
            animation: d.design_animation || 'slide',
            borderRadius: parseInt(d.design_border_radius || 0, 10),
            shadow: d.design_shadow != null ? isEnabled(d.design_shadow) : true,
          },
          emptyCart: {
            message: d.empty_cart_message || 'Your cart is empty',
            showContinueShopping: d.empty_cart_show_continue_shopping != null ? isEnabled(d.empty_cart_show_continue_shopping) : true,
            showRecommendations: d.empty_cart_show_recommendations != null ? isEnabled(d.empty_cart_show_recommendations) : true,
          },
          countdown: parseCountdownData(d),
        };
        _ccActive = true;

        await enrichUpsellProducts(CONFIG.upsell);
      } else {
        // API returned error / no record for this shop — fall back to defaults
        // so the drawer still works even if the merchant hasn't saved settings yet.
        if (!CONFIG) {
          CONFIG = {
            cartStatus: true,
            progress: { enabled: false, tiers: [], mode: 'amount', showOnEmpty: false, maxTarget: 1000, barBackgroundColor: '#e2e8f0', barForegroundColor: '#2563eb', borderRadius: 8, completionText: '🎉 All Rewards Unlocked!' },
            coupon: { enabled: false, selectedActiveCoupons: [], style: 'style-2', position: 'top', layout: 'grid', alignment: 'horizontal', title: { text: 'Apply Coupon', fontSize: 14, textColor: '#1e293b', alignment: 'left' }, couponOverrides: {}, allCouponDetails: [] },
            upsell: { enabled: false, manualRules: [], direction: 'vertical', layout: 'carousel', position: 'bottom', showOnEmptyCart: false, showIfInCart: false, limit: 3, buttonText: 'Add to cart', upsellTitle: { text: 'Recommended for you', color: '#111827', bold: false, italic: false, underline: false }, activeTemplate: 'grid' },
            announcement: { enabled: false, text: '', bgColor: '#4f46e5', textColor: '#ffffff', fontSize: 14 },
            header: { title: 'Your Cart', bgColor: '#f9fafb', textColor: '#000000', borderBottom: true },
            design: { animation: 'slide', borderRadius: 0, shadow: true },
            showWatermark: true,
          };
          _ccActive = true;
        }
      }

      if (couponRes && couponRes.ok) {
        try {
          const couponJson = await couponRes.json();
          if (couponJson.status === 'success' && Array.isArray(couponJson.data)) {
            COUPONS = couponJson.data;
          }
        } catch (e) { }
      }
    } catch (e) {
      console.error('[CartDrawer] Config load FAILED:', e);
      // API failed — use minimal fallback so the drawer can still open
      if (!CONFIG) {
        CONFIG = {
          cartStatus: true,
          progress: { enabled: false, tiers: [], mode: 'amount', showOnEmpty: false, maxTarget: 1000, barBackgroundColor: '#e2e8f0', barForegroundColor: '#2563eb', borderRadius: 8, completionText: '🎉 All Rewards Unlocked!' },
          coupon: { enabled: false, selectedActiveCoupons: [], style: 'style-2', position: 'top', layout: 'grid', alignment: 'horizontal', title: { text: 'Apply Coupon', fontSize: 14, textColor: '#1e293b', alignment: 'left' }, couponOverrides: {}, allCouponDetails: [] },
          upsell: { enabled: false, manualRules: [], direction: 'vertical', layout: 'carousel', position: 'bottom', showOnEmptyCart: false, showIfInCart: false, limit: 3, buttonText: 'Add to cart', upsellTitle: { text: 'Recommended for you', color: '#111827', bold: false, italic: false, underline: false }, activeTemplate: 'grid' },
          announcement: { enabled: false, text: '', bgColor: '#4f46e5', textColor: '#ffffff', fontSize: 14 },
          header: { title: 'Your Cart', bgColor: '#f9fafb', textColor: '#000000', borderBottom: true },
          design: { animation: 'slide', borderRadius: 0, shadow: true },
        };
        _ccActive = true;
      }
    } finally {
      _ccConfigLoading = false;
    }
  }

  function parseJSON(val) {
    if (!val) return {};
    if (typeof val === 'object') return val;
    try {
      return JSON.parse(val);
    } catch (e) {
      return {};
    }
  }

  function isEnabled(val) {
    return val == 1 || val == '1' || val === true || val === 'true' || val === 'active' || val === 'enabled';
  }

  function coerceBoolean(val, defaultValue) {
    if (val === undefined || val === null) return defaultValue;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'enabled' || s === 'active') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'disabled' || s === 'inactive') return false;
    }
    return defaultValue;
  }

  function normalizeUpsellDirection(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'horizontal' || s === 'row') return 'horizontal';
    if (s === 'vertical' || s === 'column' || s === 'block') return 'vertical';
    return 'vertical';
  }

  function normalizeUpsellLayout(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (s === 'grid') return 'grid';
    if (s === 'carousel') return 'carousel';
    return 'carousel';
  }

  function ccExtractNumericId(value) {
    if (value === undefined || value === null) return '';
    const s = String(value).trim();
    if (!s) return '';
    const match = s.match(/(\d+)(?:\?.*)?$/);
    return match ? match[1] : '';
  }

  function parseProgressData(d) {
    const data = parseJSON(d.progress_data || d.progressData);
    const enabled = isEnabled(d.progress_status) || isEnabled(d.progressStatus) || isEnabled(data.enabled);
    // Use the explicitly saved mode field first (matches what admin saves via handleSaveAll).
    // The admin's "By item count" option saves the string 'count', but every
    // check below (and in getProgressInfo) tests for 'quantity' — normalize
    // here so item-count tiers are compared against cart quantity instead of
    // silently falling back to cart total price.
    const rawMode = data.mode || (data.rewardsCalculation?.[0] === 'cartQuantity' ? 'quantity' : 'amount');
    const mode = rawMode === 'count' ? 'quantity' : rawMode;

    const rawTiers = Array.isArray(data.tiers) ? data.tiers : [];
    const parsedTiers = rawTiers
      .map((t) => {
        // Robustly parse target: try multiple fields, coerce to number.
        // The admin editor always writes the merchant's entered threshold
        // into minValue/minimumSpend (kept in sync on save/load) whether the
        // tier is an amount or an item-count target — minQuantity is a
        // legacy field that's never actually populated by the UI. Read
        // minValue/minimumSpend first regardless of mode so item-count tiers
        // don't fall through to a bogus default of 1.
        const target = parseFloat(t.minValue) || parseFloat(t.minimumSpend) || parseFloat(t.minQuantity) || parseFloat(t.target) || (mode === 'quantity' ? 1 : 0);
        return {
          id: t.id,
          target: target,
          title: t.title || '',
          rewardText: t.description || 'Reward',
          // The admin's ProductPickerModal saves this as `rewardProducts`;
          // some write paths (the AI-tool legacy sync) also mirror it as
          // `products` — accept either so a reward product picked in the
          // manual editor is never silently dropped here.
          products: t.products || t.rewardProducts || [],
          rewardType: t.rewardType || 'product',
          iconType: t.iconType || 'preset',
          // The admin's ProgressBarSection tier editor saves the icon key
          // under `icon` (defaultTier.icon, updateTier(...{icon: v})) — not
          // `iconPreset`, which only ever gets populated by the older
          // normalized/AI-tool write paths. Read `icon` first so a tier icon
          // picked in the current UI actually reaches the storefront instead
          // of silently falling back to 'gift' every time.
          iconPreset: t.icon || t.iconPreset || 'gift',
          iconCustomSvg: t.iconCustomSvg || '',
        };
      })
      .sort((a, b) => a.target - b.target);

    // Derive maxTarget: highest tier target, then saved maxTarget, then 1000
    const highestTier = parsedTiers.length > 0 ? Math.max(...parsedTiers.map((t) => t.target)) : 0;
    const maxTarget = highestTier > 0 ? highestTier : parseFloat(data.maxTarget) || 1000;


    return {
      enabled,
      mode,
      showOnEmpty: data.showOnEmpty !== false,
      barBackgroundColor: data.barBackgroundColor || data.colors?.background || '#e2e8f0',
      barForegroundColor: data.barForegroundColor || data.fill_color || data.colors?.fill || '#2563eb',
      iconColor: data.iconColor || data.icon_color || data.colors?.icon || data.barForegroundColor || data.fill_color || data.colors?.fill || '#2563eb',
      borderRadius: data.borderRadius || 8,
      completionText: data.completionText || data.completionMessage || '🎉 All Rewards Unlocked!',
      completionTextColor: data.completionTextColor || data.colors?.message || '#10b981',
      enableConfetti: data.enableConfetti ?? true,
      maxTarget: maxTarget,
      tiers: parsedTiers,
      // The admin's ProgressBarSection saves this field as `position`
      // (defaultCartEditorState.body.progressBar.position) — `placement` is
      // never actually written, so without the `data.position` fallback the
      // storefront always rendered the bar at the top regardless of what the
      // merchant picked.
      placement: data.placement || data.position || 'top',
    };
  }

  function parseCountdownData(d) {
    const data = parseJSON(d.countdown_data || d.countdownData);
    const enabled = isEnabled(d.countdown_status) || isEnabled(d.countdownStatus) || isEnabled(data.enabled);
    return {
      enabled,
      mode: data.mode === 'fixed' ? 'fixed' : 'session',
      hours: parseInt(data.hours || 0, 10),
      minutes: parseInt(data.minutes || 15, 10),
      label: data.label || 'Offer expires in',
      expiredLabel: data.expiredLabel || 'Offer expired!',
      bgColor: data.bgColor || '#fef2f2',
      textColor: data.textColor || '#991b1b',
      accentColor: data.accentColor || '#dc2626',
      couponCode: data.couponMode === 'manual' ? (data.couponCode || null) : null,
    };
  }

  function parseCheckoutButtonStyle(d) {
    const raw = d.checkout_button_style;
    if (!raw) return { backgroundColor: '#111827', textColor: '#ffffff', borderRadius: 12, mobileButtonType: 'standard' };
    const data = typeof raw === 'string' ? parseJSON(raw) : raw;
    return {
      backgroundColor: data.backgroundColor || '#111827',
      textColor: data.textColor || '#ffffff',
      borderRadius: data.borderRadius !== undefined ? parseInt(data.borderRadius, 10) : 12,
      mobileButtonType: (data.mobileButtonType === 'swipe' || data.mobileButtonType === 'animated') ? data.mobileButtonType : 'standard',
    };
  }

  function parseCouponData(d) {
    const data = parseJSON(d.coupon_data || d.couponData);
    const enabled = isEnabled(d.coupon_status) || isEnabled(d.couponStatus) || isEnabled(data.enabled);

    const title = data && typeof data.title === 'object' && data.title ? data.title : {};
    // data.titleTextAlign is the Cart Editor field name; data.titleAlignment is the legacy name
    const rawAlign = title.alignment || data.titleTextAlign || data.titleAlignment || 'left';
    const safeAlign = rawAlign === 'center' || rawAlign === 'right' || rawAlign === 'left' ? rawAlign : 'left';

    // Normalize position: product-widget placement values leak into coupon_data
    const rawPos = data.position || 'top';
    const position = (rawPos === 'above_cart' || rawPos === 'above_atc') ? 'top'
                   : (rawPos === 'below_cart' || rawPos === 'below_atc') ? 'bottom'
                   : rawPos;

    // Map Cart Editor template names → storefront style names
    // minimal-card  = style-1 (white bg, colored left border, outline button)
    // bold-vibrant  = style-2 (full colored bg, centered, large icon)
    // classic-banner = style-3 (colored header + white body + dashed code box)
    const TEMPLATE_STYLE_MAP = {
      'minimal-card':  'style-1',
      'bold-vibrant':  'style-2',
      'classic-banner':'style-3',
      'template1':     'style-1',
      'template2':     'style-2',
      'template3':     'style-3',
    };
    const style = data.style || data.selectedStyle
      || TEMPLATE_STYLE_MAP[data.template]
      || 'style-2';

    // Handle Cart Editor format: selectedCoupons (full objects) → selectedActiveCoupons (IDs) + allCouponDetails
    let selectedActiveCoupons = data.selectedActiveCoupons || [];
    let allCouponDetails = data.allCouponDetails || [];

    if (!selectedActiveCoupons.length && Array.isArray(data.selectedCoupons) && data.selectedCoupons.length) {
      selectedActiveCoupons = data.selectedCoupons.map(c => c.id).filter(Boolean);
      allCouponDetails = data.selectedCoupons.map(c => ({
        id: c.id,
        code: c.code || c.labelText || '',
        label: c.labelText || c.code || '',
        description: c.description || '',
        backgroundColor: c.bgColor || c.backgroundColor || '#4f46e5',
        textColor: c.textColor || '#ffffff',
        borderRadius: c.borderRadius ?? 8,
        iconKey: c.icon || 'discount',
        button: {
          text: c.buttonText || 'Apply',
          backgroundColor: c.buttonBgColor || c.buttonBackgroundColor || '#000000',
          textColor: c.buttonTextColor || '#ffffff',
        },
      }));
    }

    return {
      enabled,
      style,
      position,
      layout: data.layout || 'grid',
      alignment: data.alignment || 'horizontal',
      singleCouponAlignment: ['left', 'center', 'right'].includes(data.singleCouponAlignment) ? data.singleCouponAlignment : 'left',
      title: {
        // Cart Editor saves sectionTitle; legacy saves titleText; structured saves title.text
        text: title.text || data.sectionTitle || data.titleText || 'Apply Coupon',
        fontSize: parseInt(title.fontSize ?? data.titleFontSize ?? 14, 10) || 14,
        // Cart Editor saves titleColor; legacy saves titleTextColor; structured saves title.textColor
        textColor: title.textColor || data.titleColor || data.titleTextColor || '#1e293b',
        alignment: safeAlign,
      },
      selectedActiveCoupons,
      couponOverrides: data.couponOverrides || {},
      allCouponDetails,
    };
  }

  function parseUpsellData(d) {
    const data = parseJSON(d.upsell_data || d.upsellData);
    const enabled = isEnabled(d.upsell_status) || isEnabled(d.upsellStatus) || isEnabled(data.enabled);
    const direction = normalizeUpsellDirection(data.direction);
    const layout = normalizeUpsellLayout(data.layout);
    const limitRaw = Number.parseInt(String(data.limit ?? 3), 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 3;

    return {
      enabled,
      upsellMode: data.upsellMode || 'manual',
      useAI: coerceBoolean(data.useAI, true),
      showIfInCart: coerceBoolean(data.showIfInCart, false),
      limit: limit,
      showReviews: coerceBoolean(data.showReviews, false),
      position: data.position || 'bottom',
      direction,
      showOnEmptyCart: coerceBoolean(data.showOnEmptyCart, true),
      buttonText: data.buttonText || 'Add to cart',
      upsellTitle: {
        text: data.upsellTitle?.text || 'Recommended for you',
        color: data.upsellTitle?.color || '#111827',
        bold: data.upsellTitle?.formatting?.bold || false,
        italic: data.upsellTitle?.formatting?.italic || false,
        underline: data.upsellTitle?.formatting?.underline || false,
      },
      manualRules: data.manualRules || [],
      activeTemplate: data.activeTemplate || 'grid',
      layout, // 'carousel' or 'grid'
    };
  }

  /* =================== UPSELL PRODUCT ENRICHMENT =================== */

  async function enrichUpsellProducts(upsell) {
    // The admin editor only ever saves plain product IDs under
    // `rule.upsellProductIds` (see app/components/sections/UpsellSection.jsx)
    // — it never writes a `upsellProductDetails` field. The old check here
    // read `rule.upsellProductDetails` for "is there anything to enrich?",
    // which is always empty/undefined, so this whole function — including
    // the individual per-product fallback below — silently never ran.
    // renderUpsellSectionAsync() falls back to the bulk store-catalog lookup
    // for products that ARE within its first 250 results, but shops with
    // more products than that (or a catalog fetch hiccup) had no recovery
    // path for the rest until this actually builds upsellProductDetails.
    const hasAnyManualProducts = (upsell.manualRules || []).some(
      (rule) => (rule.upsellProductIds || []).length > 0
    );
    if (!hasAnyManualProducts) return;

    try {
      const res = await originalFetch('/products.json?limit=250');
      const data = await res.json();
      // Build lookup map: numeric product ID → product object
      const productMap = {};
      for (const p of data.products || []) {
        productMap[String(p.id)] = p;
      }

      for (const rule of upsell.manualRules || []) {
        rule.upsellProductDetails = (rule.upsellProductIds || []).map((rawId) => {
          const numId = ccExtractNumericId(rawId) || String(rawId || '').replace('gid://shopify/Product/', '');
          const sp = productMap[numId];
          if (sp) {
            return {
              id: numId,
              title: sp.title,
              price: sp.variants?.[0]?.price || sp.price_min || '',
              image: sp.images?.[0]?.src || sp.featured_image || null,
              handle: sp.handle,
              variantId: sp.variants?.[0]?.id || null,
            };
          }
          return { id: numId };
        });

        // Individual fallback: try to resolve any products still missing variantId
        for (let i = 0; i < rule.upsellProductDetails.length; i++) {
          const detail = rule.upsellProductDetails[i];
          if (!detail.variantId && detail.handle) {
            try {
              const pRes = await originalFetch('/products/' + detail.handle + '.json');
              if (pRes.ok) {
                const pData = await pRes.json();
                const sp = pData.product;
                if (sp && sp.variants && sp.variants.length > 0) {
                  rule.upsellProductDetails[i] = {
                    ...detail,
                    title: detail.title || sp.title,
                    price: detail.price || sp.variants[0].price || '',
                    image: detail.image || sp.images?.[0]?.src || null,
                    variantId: sp.variants[0].id,
                  };
                }
              }
            } catch (innerErr) {
            }
          }
          // Final warning if still no variantId
          if (!rule.upsellProductDetails[i].variantId) {
          }
        }
      }
    } catch (e) {
    }
  }

  /* =================== OPEN DRAWER =================== */

  async function openDrawer() {
    if (!CONFIG) {
      // Avoid concurrent loads
      if (_ccConfigLoading) {
        // Wait up to 3s for the in-flight load to finish
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 100));
          if (CONFIG) break;
        }
      } else {
        await loadConfig();
      }
    }
    if (!CONFIG) {
      return;
    }
    renderDrawer();
  }

  /* =================== CLOSE DRAWER =================== */

  function closeDrawer() {
    const overlay = document.getElementById('cc-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => {
        const root = document.getElementById('cc-root');
        if (root) root.innerHTML = '';
      }, 350);
    }
  }

  /* =================== DEBOUNCED OPEN =================== */
  // Single debounce prevents duplicate opens when multiple triggers fire at once.
  let _ccOpenTimer = null;
  function scheduleOpenDrawer(delay) {
    if (_ccOpenTimer) clearTimeout(_ccOpenTimer);
    _ccOpenTimer = setTimeout(function () {
      _ccOpenTimer = null;
      openDrawer();
    }, delay || 350);
  }

  /* =================== CART ACTION INTERCEPTS =================== */

  // 1. Fetch intercept — catches AJAX add-to-cart calls (only on success)
  const originalFetch = window.fetch;

  async function ccGetStoreCatalog() {
    const now = Date.now();
    if (
      _ccStoreCatalogCache.ts &&
      now - _ccStoreCatalogCache.ts < CC_STORE_CATALOG_CACHE_TTL_MS &&
      Array.isArray(_ccStoreCatalogCache.candidateCatalog) &&
      _ccStoreCatalogCache.candidateCatalog.length > 0
    ) {
      return _ccStoreCatalogCache;
    }

    if (_ccStoreCatalogPromise) {
      return _ccStoreCatalogPromise;
    }

    _ccStoreCatalogPromise = (async () => {
      try {
        const res = await originalFetch('/products.json?limit=250');
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const products = Array.isArray(data?.products) ? data.products : [];

        const candidateCatalog = [];
        const detailsById = {};

        products.forEach((p) => {
          const id = p && p.id != null ? String(p.id) : '';
          const title = p && p.title != null ? String(p.title) : '';
          if (!id || !title) return;

          candidateCatalog.push({ id, title });
          detailsById[id] = {
            id,
            title,
            price: p?.variants?.[0]?.price || p?.price_min || '',
            compareAtPrice: p?.variants?.[0]?.compare_at_price || null,
            image: p?.images?.[0]?.src || p?.featured_image || null,
            handle: p?.handle || '',
            variantId: p?.variants?.[0]?.id || null,
          };
        });

        _ccStoreCatalogCache = {
          ts: Date.now(),
          candidateCatalog,
          detailsById,
        };

        return _ccStoreCatalogCache;
      } catch (e) {
        return null;
      } finally {
        _ccStoreCatalogPromise = null;
      }
    })();

    return _ccStoreCatalogPromise;
  }

  window.fetch = async function (...args) {
    // Marked synchronously, BEFORE awaiting the response — a same-node
    // theme submit listener that runs before ours calls fetch()
    // synchronously (the request is dispatched immediately even though the
    // response resolves later), so this must be set here, not after the
    // await below, or our own submit interceptor's duplicate-check would
    // always see it too late.
    try {
      const dispatchUrl = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
      if (dispatchUrl.includes('/cart/add')) {
        _ccExternalAddInFlightAt = Date.now();
        ccCountAddRequest('window.fetch (external)');
      }
    } catch (e) { /* noop — args[0] shape unexpected, safe to ignore */ }

    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
      if (url.includes('/cart/add') && response.ok) {
        scheduleOpenDrawer(350);
      }
    } catch (e) { }
    return response;
  };

  // 2. XHR intercept — catches themes that use XMLHttpRequest (only on success)
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && url.includes('/cart/add')) {
      // Marked here (at open time, before send()) for the same reason as
      // the fetch patch above — needs to be visible to our submit
      // interceptor's duplicate-check as early as possible.
      _ccExternalAddInFlightAt = Date.now();
      ccCountAddRequest('XMLHttpRequest (external)');
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300) {
          scheduleOpenDrawer(350);
        }
      });
    }
    return originalXHROpen.apply(this, arguments);
  };

  // 3. Form submit intercept — prevents page navigation and converts to AJAX.
  // This is critical for themes that do a real form POST to /cart/add.
  // Only intercepts when _ccActive is true — if the drawer is disabled or not
  // yet configured, we let the theme handle add-to-cart naturally so the user
  // always gets feedback even when the drawer config is missing/unavailable.
  // Before doing its own POST it also checks _ccExternalAddInFlightAt — see
  // that variable's own comment — to avoid double-adding on themes whose
  // own delegated submit handling runs before ours in the same dispatch.
  document.addEventListener('submit', function (e) {
    const form = e.target;
    // Positive-check gate: only a real Shopify add-to-cart form (action
    // contains /cart/add) with our drawer actually active gets touched.
    // Every other form (newsletter, contact, login, search, currency
    // selector) falls straight through untouched.
    if (!form || !form.action || !form.action.includes('/cart/add')) return;
    if (!_ccActive) return; // drawer not active — let theme handle it

    // Some themes are built on a component framework whose own submit
    // handling captures a reference to the real native fetch/XHR before
    // this script ever runs, entirely bypassing the window.fetch/XHR
    // patches below (_ccExternalAddInFlightAt never sees those calls) — so
    // that detection alone isn't enough. event.defaultPrevented is a more
    // fundamental, unbypassable signal: if a same-node listener ran before
    // ours (same capture-phase/document registration-order reasoning as
    // stopImmediatePropagation's own limits, see below) and already called
    // preventDefault as the first thing it does — normal for any handler
    // about to do its own AJAX add — that flag is already true here,
    // regardless of which API it used to actually perform the add.
    if (e.defaultPrevented) {
      ccDebug('submit intercept: defaultPrevented already true — a listener that ran before ours is already handling this submission, not adding again');
      return;
    }

    ccMilestone('Add-to-cart intercepted');
    ccDebug('submit intercept: matched /cart/add form, taking ownership', form);
    // stopImmediatePropagation only fires once we've confirmed (above) that
    // this is genuinely a cart/add submission we are about to handle
    // ourselves end-to-end — never for unrelated forms/events. This still
    // lets analytics/pixel/loyalty apps react normally: they observe the
    // resulting /cart/add.js network call (via their own fetch/XHR patch or
    // Shopify.onItemAdded), not the DOM submit event itself. Note this
    // cannot undo a same-node listener that ran BEFORE ours (see the
    // duplicate-add check right below) — it only stops listeners
    // registered after this one.
    e.preventDefault();
    ccMilestone('Native submit prevented');
    e.stopImmediatePropagation();

    // Transaction guard: a rapid double-click can fire a second, separately
    // valid 'submit' event before the theme disables the button — this
    // would sail through the checks below (they're per-submission, not
    // cross-submission) and produce a second real POST. If one is already
    // in flight, prevent navigation (above) but do nothing further; the
    // in-flight request will update the cart and open the drawer once it
    // resolves. Resets automatically on success/failure/timeout (see
    // ccEndAddToCartTransaction), so this can never permanently block a
    // later, legitimate Add to Cart click.
    if (_ccAddToCartInFlight) {
      ccDebug('submit intercept: a transaction is already in flight, ignoring this duplicate submission (double-click guard)');
      return;
    }

    const submitStartedAt = Date.now();
    (async function () {
      // Some themes (component-framework based, e.g. a single global
      // delegated submit listener on document) already perform their own
      // AJAX add-to-cart, and if that listener happens to be registered
      // before ours it runs first — synchronously, in the same event
      // dispatch — before this code even starts. _ccExternalAddInFlightAt
      // is set the instant such a call is dispatched (see the fetch/XHR
      // patches above), so checking it here catches that case immediately.
      // A short grace wait also catches themes whose own add is
      // microtask/rAF-deferred rather than strictly synchronous, without
      // meaningfully delaying the fallback path for themes that need us to
      // do the add ourselves.
      if (_ccExternalAddInFlightAt < submitStartedAt) {
        await new Promise(function (resolve) { setTimeout(resolve, 60); });
      }
      if (_ccExternalAddInFlightAt >= submitStartedAt) {
        ccDebug('submit intercept: theme already added this item itself, skipping our own duplicate POST');
        scheduleOpenDrawer(250);
        return;
      }

      const formData = new FormData(form);
      ccMilestone('Product/variant:', formData.get('id'));
      ccMilestone('Quantity:', formData.get('quantity') || '1');
      ccBeginAddToCartTransaction();
      ccMilestone('Cart request started');
      ccCountAddRequest('submit interceptor (ours)');
      originalFetch('/cart/add.js', { method: 'POST', body: formData })
      .then(function (res) {
        ccEndAddToCartTransaction();
        if (res.ok) {
          ccMilestone('Cart request completed');
          ccDebug('submit intercept: /cart/add.js succeeded, opening drawer');
          scheduleOpenDrawer(300);
        } else {
          // A real Shopify error (e.g. 422 sold out / invalid variant) —
          // this is a legitimate answer, not an interception failure, so we
          // don't fall back to a native re-submit (it would just fail the
          // same way with no visible feedback at all).
          ccDebug('submit intercept: /cart/add.js responded not-ok', res.status);
        }
      })
      .catch(function (err) {
        ccEndAddToCartTransaction();
        // Our AJAX path itself failed (network error, blocked request,
        // etc.) — gracefully fall back to the native form submission
        // instead of silently leaving the customer stuck with no cart
        // feedback at all. form.submit() bypasses the 'submit' event (per
        // spec it does not re-dispatch it), so this can't loop back into
        // this same listener.
        ccDebug('submit intercept: fetch failed, falling back to native form.submit()', err);
        try { form.submit(); } catch (fallbackErr) { ccDebug('submit intercept: native fallback also failed', fallbackErr); }
      });
    })();
  }, true); // capture phase — fires before theme JS

  // 3b. Universal cart polling — checks /cart.js every 1.5s and opens drawer
  // if item_count increases. This catches every add-to-cart regardless of method.
  (function () {
    let _ccPollCount = -1;
    let _ccPollActive = false;
    function ccPoll() {
      if (_ccPollActive) return;
      _ccPollActive = true;
      originalFetch('/cart.js')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          const count = data.item_count || 0;
          if (_ccPollCount !== -1 && count > _ccPollCount) {
            scheduleOpenDrawer(150);
          }
          _ccPollCount = count;
        })
        .catch(function () { })
        .finally(function () { _ccPollActive = false; });
    }
    ccPoll(); // set baseline immediately
    setInterval(ccPoll, 1500);
  })();

  // 4. Common Shopify theme custom events
  // Covers Dawn, Debut, Brooklyn, Impulse, Turbo, Prestige, Broadcast,
  // Focal, Impact, Symmetry, Flex, Warehouse, Pipeline, District, and most 3rd-party themes
  [
    'cart:item-added',
    'cart:updated',
    'cart:add',
    'cart:refresh',
    'on:cart:add',
    'shopify:cart:added',
    'theme:cart:open',
    'cart:open',
    // Additional theme events
    'cart:add-item',
    'cart:added',
    'cart.added',
    'ajaxProduct:added',
    'ajaxCart:itemAdded',
    'CartDrawer:open',
    'cart-drawer:open',
    'theme:cart:drawer-open',
    'bc-ajax-add',
    'product:added',
    'items:added',
    'theme:mini-cart:open',
    'cart:open-drawer',
    'theme:cart-drawer:open',
    // Archetype themes (Impulse, Motion, Streamline)
    'cart:open',
    'ajaxCart:open',
    // Debut / vintage
    'ajaxCart:buildCart',
    'cart.requestComplete',
    // Prestige
    'drawer:open',
    // General / third-party
    'cart:build',
  ].forEach(function (evt) {
    document.addEventListener(evt, function () {
      scheduleOpenDrawer(300);
    });
    window.addEventListener(evt, function () {
      scheduleOpenDrawer(300);
    });
  });

  // 5. Click delegation — fires after any add-to-cart button click
  // Uses capture so it fires before theme JS can stop propagation
  document.addEventListener(
    'click',
    function (e) {
      if (
        e.target.closest(
          '[name="add"],' +
          '[data-add-to-cart],' +
          '[data-action="add-to-cart"],' +
          '.btn-add-to-cart,' +
          '.add-to-cart,' +
          '.product-form__submit,' +
          // Additional theme-specific selectors
          '.product-form__cart-submit,' +
          '[data-cart-add],' +
          '[data-product-add],' +
          '[data-btn-addtocart],' +
          '[data-add-to-bag],' +
          '#AddToCart,' +
          '.AddToCart,' +
          '[id^="AddToCart"],' +
          '[id*="add-to-cart"],' +
          '[class*="add_to_cart"],' +
          '[class*="addToCart"],' +
          '.btn--add-to-cart,' +
          '.button--add-to-cart,' +
          '.js-add-to-cart,' +
          '.js-ajax-submit,' +
          '[data-product-form-submit],' +
          '[data-add-to-cart-trigger],' +
          '.cart__add-btn,' +
          '.product__add-to-cart,' +
          '.product-single__cart-submit,' +
          '[data-testid="cart-drawer-trigger"]'
        )
      ) {
        scheduleOpenDrawer(600);
      }
    },
    true
  );

  // Shared "is this a known native cart drawer?" identification — used both
  // by the generic click fallback right below and by the body
  // MutationObserver further down, so there's exactly one place that
  // defines what counts as a positively-identified native drawer.
  const CC_DRAWER_TAGS = [
    'cart-notification', 'cart-drawer',   // Dawn family
    'mini-cart',                           // Focal / Impact
    'drawer-component', 'sidebar-cart', 'ajax-cart', // other modern themes
  ];
  const CC_DRAWER_IDS = [
    'CartDrawer', 'cart-sidebar', 'MiniCart', 'mini-cart',
    'ajax-cart', 'CartContainer', 'slideout-cart', 'slide-cart', 'flyout-cart',
    'sidebar-cart',                        // Prestige / Warehouse
    'cart-drawer',                         // Saviour (confirmed via aria-controls="cart-drawer" on the header cart button)
  ];
  const CC_OPEN_CLASSES = [
    'open', 'is-open', 'is-visible', 'active', 'is-active', 'show', 'cart--open',
    'drawer--is-open',                     // Debut / Brooklyn / Impulse
    'drawer--open',                        // Prestige / Focal / Impact
    'drawer--visible',                     // Pipeline / Broadcast
    'js-drawer-open',                      // Archetype themes (applied to body)
  ];
  // Distinct from CC_OPEN_CLASSES above — these are STATE classes themes
  // apply to <html>/<body> (not to the drawer element itself) that their
  // own stylesheet keys push-layout rules off, independent of whether the
  // drawer panel is visible. Shared here (not just inside
  // ccNeutralizeNativeDrawer) so the diagnostic instrumentation below can
  // recognize and log the same set.
  const CC_DRAWER_STATE_CLASSES = ['cart-drawer-open', 'drawer-open', 'js-drawer-open', 'cart-open', 'is-open', 'open-drawer'];
  function ccLooksLikeNativeDrawer(el) {
    if (!el || !el.tagName) return false;
    // Explicit exclusion, checked first: never treat anything inside Cart
    // Ninja's own drawer as a native one, regardless of any class/id/tag
    // naming coincidence the heuristics below might otherwise match.
    if (typeof el.closest === 'function' && el.closest('[data-cart-ninja-drawer]')) return false;
    return (
      CC_DRAWER_TAGS.includes(el.tagName.toLowerCase()) ||
      CC_DRAWER_IDS.includes(el.id) ||
      (el.className && typeof el.className === 'string' &&
        (el.className.includes('cart-drawer') || el.className.includes('mini-cart') ||
          el.className.includes('ajax-cart') || el.className.includes('cart-sidebar') ||
          el.className.includes('drawer--cart') || el.className.includes('drawer--right') ||
          el.className.includes('mini_cart') || el.className.includes('cart_container') ||
          el.className.includes('theme-drawer'))) // Saviour theme
    );
  }

  // 5b. Cart icon intercept — opens our drawer when the theme's cart icon is clicked
  // Covers Dawn, Debut, Brooklyn, Impulse, Focal, Impact, Prestige, Turbo, Flex,
  // Broadcast, Symmetry, Pipeline, Warehouse, and generic catch-alls
  document.addEventListener('click', function (e) {
    const cartTrigger = e.target.closest(
      // Dawn family
      '#cart-icon-bubble,' +
      '.header__icon--cart,' +
      // Debut / Brooklyn
      '.site-header__cart,' +
      '.site-header__cart-toggle,' +
      // Archetype (Impulse, Motion, Streamline)
      '.site-nav__link--cart,' +
      '.js-drawer-open-cart,' +
      // Maestrooo (Focal, Impact, Warehouse)
      '[aria-controls="mini-cart"],' +
      '[aria-controls="sidebar-cart"],' +
      '[data-action="open-mini-cart"],' +
      '[data-action="toggle-cart"],' +
      '[data-action="open-cart"],' +
      // Prestige
      '[data-action="open-drawer"],' +
      '.header__cart-toggle,' +
      // Out of the Sandbox (Turbo, Flex)
      '.cart-button,' +
      '.header-cart,' +
      '[data-show-cart],' +
      '.mini_cart-toggle,' +
      // Broadcast
      '[data-drawer-trigger="cart-drawer"],' +
      '.header__cart__link,' +
      // Symmetry
      '.cart-link,' +
      '.toggle-cart,' +
      // Pipeline
      '[data-cart-toggle],' +
      '.header-cart__link,' +
      // Current theme
      '[data-testid="cart-drawer-trigger"],' +
      // Universal catch-alls
      'a[href="/cart"],' +
      '[data-ajax-cart-trigger]'
    );
    if (cartTrigger) {
      if (!_ccActive) return; // drawer not configured — let theme handle cart navigation
      ccDebug('cart trigger intercept: matched known selector', cartTrigger);
      e.preventDefault();
      e.stopImmediatePropagation();
      openDrawer();
      return;
    }

    // Fallback for themes outside the selector list above: a toggle button
    // that references a target via aria-controls (a standard accessibility
    // pattern for disclosure/toggle widgets) is only treated as a cart
    // trigger if the referenced element positively matches our known
    // native-drawer identification (ccLooksLikeNativeDrawer) — never a
    // blanket "any aria-controls button", which would risk intercepting
    // unrelated toggles (mobile nav, filters, newsletter modals, etc.).
    if (!_ccActive) return;
    const ariaBtn = e.target.closest('[aria-controls]');
    if (!ariaBtn) return;
    const targetId = ariaBtn.getAttribute('aria-controls');
    const targetEl = targetId && document.getElementById(targetId);
    if (targetEl && ccLooksLikeNativeDrawer(targetEl)) {
      ccDebug('cart trigger intercept: generic aria-controls fallback matched', ariaBtn, targetEl);
      e.preventDefault();
      e.stopImmediatePropagation();
      openDrawer();
    }
  }, true);

  // 6. Shopify section rendering events (used when themes reload sections via AJAX)
  document.addEventListener('shopify:section:load', function () {
    if (new URL(location.href).searchParams.get('added')) scheduleOpenDrawer(100);
    // Re-scan for cart-count badges — a section reload can swap in a NEW
    // element (e.g. header re-render), which the one-time querySelectorAll
    // at boot would never see. Safe to call repeatedly: each element
    // self-guards via el._ccWatching, so already-watched badges are skipped.
    ccDebug('shopify:section:load — re-scanning cart-count badges');
    ccWatchCartCount();
  });

  // 7. MutationObserver — watches ALL cart count badges as a last-resort fallback.
  // Fires when count increases, meaning an item was just added.
  const CC_COUNT_SELECTOR =
    '[data-cart-count],[data-cart-item-count],[data-item-count],' +
    '.cart-count,.cart__item-count,.CartCount,#cart-icon-bubble,' +
    '.cart-item-count,.site-header__cart-count,#cart-count,' +
    '[data-header-cart-count],.header__cart-count,.nav-cart-count,' +
    '.cart-link__count,.header-cart-count,.cart__count';

  function ccWatchCartCount() {
    document.querySelectorAll(CC_COUNT_SELECTOR).forEach(function (el) {
      if (el._ccWatching) return;
      el._ccWatching = true;
      let lastCount = parseInt(el.textContent || el.getAttribute('data-cart-count') || el.getAttribute('data-item-count') || 0);
      new MutationObserver(function () {
        const now = parseInt(el.textContent || el.getAttribute('data-cart-count') || el.getAttribute('data-item-count') || 0);
        if (now > lastCount) {
          scheduleOpenDrawer(200);
        }
        lastCount = now;
      }).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    });
  }

  // 8. Body MutationObserver — detects when themes dynamically show their
  // cart drawer/panel. This is the universal fallback for themes not
  // covered by the selector lists above (uses the shared
  // ccLooksLikeNativeDrawer identification).
  //
  // Two independent signals, either one triggers: (a) a known open/active
  // class name appears (fast, precise, catches most themes), or (b) the
  // element's actual visibility (computed display/visibility/opacity, plus
  // the hidden and aria-hidden attributes) transitions from hidden to
  // shown, however the theme toggles it — some themes never add one of our
  // known class names at all, and instead toggle via inline style, the
  // `hidden` attribute, or `aria-hidden`. Tracks each element's last-known
  // visibility on the node itself (mirrors the _ccWatching pattern used for
  // cart-count elements below) so this only fires on a real hidden→shown
  // transition, not on every unrelated attribute tweak while already open.
  //
  // Beyond just opening ours, this also actively neutralizes the native
  // drawer — otherwise both end up visible at once (Bug: double drawer).
  // Neutralization only happens once the element has been POSITIVELY
  // identified as a known native drawer (never a blanket hide), and is
  // restored automatically if our own drawer fails to actually appear
  // within a short window, so a Cart Ninja failure can never leave the
  // customer with no cart access at all.
  function ccIsVisible(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') !== 0;
  }
  (function () {
    new MutationObserver(function (mutations) {
      for (const m of mutations) {
        const el = m.target;
        if (!ccLooksLikeNativeDrawer(el)) continue;
        ccMilestone('Native cart detected', el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''));
        if (m.type !== 'attributes') continue;

        const matchedOpenClass = m.attributeName === 'class' &&
          CC_OPEN_CLASSES.some((c) => el.classList.contains(c));

        const nowVisible = ccIsVisible(el);
        const wasVisible = !!el._ccPrevVisible;
        el._ccPrevVisible = nowVisible;
        const becameVisible = nowVisible && !wasVisible;

        if (!matchedOpenClass && !becameVisible) continue;
        ccMilestone('Native drawer open attempt detected (body observer)', { matchedOpenClass, becameVisible });
        ccDebug('native drawer detected via body observer', el, { matchedOpenClass, becameVisible });
        scheduleOpenDrawer(200);
        if (!_ccActive) continue; // drawer not configured — leave native panel alone
        ccNeutralizeNativeDrawer(el);
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'] });
  })();

  // Hides a positively-identified native drawer element while our own
  // drawer takes over, and restores it automatically if our drawer doesn't
  // actually render within the window below (config load failure, render
  // exception, etc.) — the customer must always end up with a usable cart.
  // Snapshots an inline style property so it can be restored later, without
  // ever needing to know what the theme's stylesheet-level default is.
  function ccSnapshotStyle(el, prop) {
    return { value: el.style[prop], priority: el.style.getPropertyPriority(prop) };
  }
  function ccRestoreStyle(el, prop, snap) {
    if (snap.value) el.style.setProperty(prop, snap.value, snap.priority);
    else el.style.removeProperty(prop);
  }

  // Hides ONE element (display:none + pointer-events:none), returns a
  // restore() closure. Split out of ccNeutralizeNativeDrawer so the same
  // hide/restore logic can be applied to a whole chain of elements, not
  // just the single one the MutationObserver happened to match.
  function ccHideSingleElement(target) {
    const prevDisplay = ccSnapshotStyle(target, 'display');
    const prevPointerEvents = ccSnapshotStyle(target, 'pointerEvents');
    target.style.setProperty('display', 'none', 'important');
    // Defense in depth alongside display:none — if later theme CSS (or a
    // subsequent re-render) ever overrides our display override, this
    // still guarantees the element can't intercept clicks/taps.
    target.style.setProperty('pointer-events', 'none', 'important');
    return function restore() {
      ccRestoreStyle(target, 'display', prevDisplay);
      ccRestoreStyle(target, 'pointerEvents', prevPointerEvents);
    };
  }

  function ccNeutralizeNativeDrawer(el) {
    try {
      if (el._ccNeutralized) return; // already handled for this open cycle

      // Themes often toggle attributes on an INNER content element (e.g.
      // .cart-drawer__inner) while an OUTER wrapper (e.g. the .cart-drawer
      // block it belongs to, or a <cart-drawer> custom element) is the one
      // that actually participates in the page's flex/grid layout and
      // reserves width for the drawer as a "track" — its own attributes
      // never change when the drawer opens/closes, so the MutationObserver
      // never matches it directly, and hiding only the inner element left
      // that outer wrapper's reserved space rendering blank instead of
      // collapsing (the "text disappeared but the space stayed" bug).
      // Walking up and also neutralizing every ancestor that independently
      // matches ccLooksLikeNativeDrawer (BEM naming makes this reliable —
      // cart-drawer__inner's ancestor chain almost always includes a
      // plain .cart-drawer element) closes that gap generically, for any
      // theme built this way, not just Saviour specifically.
      const targets = [el];
      let ancestor = el.parentElement;
      let ancestorGuard = 0;
      while (ancestor && ancestor !== document.body && ancestorGuard < 8) {
        ancestorGuard++;
        if (ccLooksLikeNativeDrawer(ancestor)) targets.push(ancestor);
        ancestor = ancestor.parentElement;
      }

      // Themes built on native <dialog> + showModal() get a browser-native
      // ::backdrop dimming layer that isn't a regular DOM node — it's not
      // selectable, doesn't have a class, and hiding the dialog's own
      // content via display:none does NOT remove it, because the dialog is
      // still logically "open" as far as the browser is concerned. Only
      // dialog.close() actually closes it and removes the backdrop (and,
      // as a side effect, collapses any reserved layout space inside it
      // too — the ancestor-walk above still runs regardless, in case the
      // reserved-space wrapper sits outside the dialog).
      const dialogAncestor = typeof el.closest === 'function' ? el.closest('dialog') : null;
      const wasOpenDialog = dialogAncestor && dialogAncestor.open;
      if (wasOpenDialog) {
        try {
          dialogAncestor.close();
          ccMilestone('Native overlay suppressed (dialog.close() removed its ::backdrop)', dialogAncestor);
          ccDebug('native drawer neutralize: closed native <dialog> ancestor (removes its ::backdrop too)', dialogAncestor);
        } catch (dialogErr) {
          ccDebug('native drawer neutralize: dialog.close() failed', dialogErr);
        }
      }

      // Many themes lock body/html scroll and add a scrollbar-compensation
      // padding/margin the instant their own drawer starts opening — that
      // JS still runs even though we hide the panel below, so without also
      // undoing it here the compensation is left applied to nothing,
      // showing up as an unexplained blank gutter on the page edge. Our
      // own drawer never relies on this (confirmed: nothing in this file
      // sets body/html overflow), so it's safe to clear.
      //
      // Beyond simple scrollbar compensation, some themes go further and
      // add a dedicated STATE CLASS to <html>/<body> (independent of
      // whichever drawer element itself we matched above) that their own
      // stylesheet keys a "push"-style layout off — e.g.
      // `body.drawer-open .page-width { width: calc(100% - 420px) }`.
      // Neither hiding the drawer panel nor clearing overflow/padding
      // touches that class at all, so the page stays visually compressed
      // even with the drawer itself fully suppressed. Removing the class
      // is the correct fix here (not guessing at the theme's specific
      // width/transform/margin CSS) — it undoes whatever the theme's own
      // stylesheet is keyed to, without us needing to know those rules.
      const prevHtmlClasses = CC_DRAWER_STATE_CLASSES.filter(function (c) { return document.documentElement.classList.contains(c); });
      const prevBodyClasses = CC_DRAWER_STATE_CLASSES.filter(function (c) { return document.body.classList.contains(c); });

      const prevBodyOverflow = ccSnapshotStyle(document.body, 'overflow');
      const prevBodyPaddingRight = ccSnapshotStyle(document.body, 'paddingRight');
      const prevBodyMarginRight = ccSnapshotStyle(document.body, 'marginRight');
      const prevBodyTransform = ccSnapshotStyle(document.body, 'transform');
      const prevBodyWidth = ccSnapshotStyle(document.body, 'width');
      const prevBodyMaxWidth = ccSnapshotStyle(document.body, 'maxWidth');
      const prevHtmlOverflow = ccSnapshotStyle(document.documentElement, 'overflow');
      const prevHtmlPaddingRight = ccSnapshotStyle(document.documentElement, 'paddingRight');
      const prevHtmlTransform = ccSnapshotStyle(document.documentElement, 'transform');
      const prevHtmlWidth = ccSnapshotStyle(document.documentElement, 'width');
      const prevHtmlMaxWidth = ccSnapshotStyle(document.documentElement, 'maxWidth');

      targets.forEach(function (t) { t._ccNeutralized = true; });
      const restoreFns = targets.map(ccHideSingleElement);
      ccMilestone('Native drawer blocked');
      ccMilestone('Native drawer suppressed', targets.map(function (t) {
        return t.tagName + (t.id ? '#' + t.id : '') + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).join('.') : '');
      }).join(' <- '));
      if (prevHtmlClasses.length) document.documentElement.classList.remove.apply(document.documentElement.classList, prevHtmlClasses);
      if (prevBodyClasses.length) document.body.classList.remove.apply(document.body.classList, prevBodyClasses);
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
      document.body.style.removeProperty('margin-right');
      document.body.style.removeProperty('transform');
      document.body.style.removeProperty('width');
      document.body.style.removeProperty('max-width');
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('padding-right');
      document.documentElement.style.removeProperty('transform');
      document.documentElement.style.removeProperty('width');
      document.documentElement.style.removeProperty('max-width');
      ccMilestone('Body state changed (cleared theme scroll-lock overflow/padding/transform/width + drawer-state classes)');
      ccDebug('native drawer neutralize: hid element(s) + cleared body/html scroll-lock', targets, { removedHtmlClasses: prevHtmlClasses, removedBodyClasses: prevBodyClasses });

      // Diagnostic-only, not a fix by itself: shortly after neutralizing,
      // check whether the page is actually back to full width. If it
      // isn't, walk document.body's direct children and log each one's
      // rendered width/transform/margin — pinpointing the exact wrapper
      // still compressing the page instead of guessing at theme-specific
      // selectors blind.
      setTimeout(function () {
        try {
          const viewportWidth = document.documentElement.clientWidth;
          const bodyWidth = document.body.getBoundingClientRect().width;
          if (bodyWidth >= viewportWidth - 4) {
            ccMilestone('Storefront layout unchanged');
            ccMilestone('No push-drawer layout detected');
          } else {
            ccMilestone('STOREFRONT WIDTH REDUCED — expected ~' + viewportWidth + 'px, body renders at ' + Math.round(bodyWidth) + 'px. Scanning body children for the culprit:');
            Array.prototype.forEach.call(document.body.children, function (child) {
              if (child.id === 'cc-root' || (child.closest && child.closest('[data-cart-ninja-drawer]'))) return;
              const rect = child.getBoundingClientRect();
              const cs = window.getComputedStyle(child);
              if (rect.width < viewportWidth - 4) {
                ccMilestone('  suspect:', child.tagName + (child.id ? '#' + child.id : '') + (child.className && typeof child.className === 'string' ? '.' + child.className.trim().split(/\s+/).join('.') : ''), {
                  renderedWidth: rect.width, computedWidth: cs.width, computedMaxWidth: cs.maxWidth,
                  computedTransform: cs.transform, computedMarginRight: cs.marginRight,
                });
              }
            });
          }
        } catch (diagErr) {
          ccDebug('native drawer neutralize: width-verification diagnostic failed', diagErr);
        }
      }, 400);

      setTimeout(function () {
        try {
          const ourOverlay = document.getElementById('cc-overlay');
          const ourDrawerOpen = ourOverlay && ourOverlay.classList.contains('active');
          if (!ourDrawerOpen) {
            // Our drawer never actually opened — restore native access
            // (and whatever scroll-lock/state it expects) rather than
            // leave the customer stranded.
            ccDebug('native drawer neutralize: our drawer did not open in time, restoring native element(s)', targets);
            restoreFns.forEach(function (restore) { restore(); });
            if (prevHtmlClasses.length) document.documentElement.classList.add.apply(document.documentElement.classList, prevHtmlClasses);
            if (prevBodyClasses.length) document.body.classList.add.apply(document.body.classList, prevBodyClasses);
            ccRestoreStyle(document.body, 'overflow', prevBodyOverflow);
            ccRestoreStyle(document.body, 'paddingRight', prevBodyPaddingRight);
            ccRestoreStyle(document.body, 'marginRight', prevBodyMarginRight);
            ccRestoreStyle(document.body, 'transform', prevBodyTransform);
            ccRestoreStyle(document.body, 'width', prevBodyWidth);
            ccRestoreStyle(document.body, 'maxWidth', prevBodyMaxWidth);
            ccRestoreStyle(document.documentElement, 'overflow', prevHtmlOverflow);
            ccRestoreStyle(document.documentElement, 'paddingRight', prevHtmlPaddingRight);
            ccRestoreStyle(document.documentElement, 'transform', prevHtmlTransform);
            ccRestoreStyle(document.documentElement, 'width', prevHtmlWidth);
            ccRestoreStyle(document.documentElement, 'maxWidth', prevHtmlMaxWidth);
            if (wasOpenDialog) {
              try { dialogAncestor.showModal(); } catch (reopenErr) { ccDebug('native drawer neutralize: dialog.showModal() restore failed', reopenErr); }
            }
          }
        } catch (restoreErr) {
          ccDebug('native drawer neutralize: restore check failed', restoreErr);
        } finally {
          targets.forEach(function (t) { t._ccNeutralized = false; });
        }
      }, 1200);
    } catch (err) {
      ccDebug('native drawer neutralize: failed, leaving native element untouched', err);
    }
  }

  // Centralized reference to Cart Ninja's native-drawer suppression system —
  // consolidates the pieces defined above/below into one documented,
  // introspectable surface (exposed as window.__CC_NATIVE_CART_SUPPRESSOR__
  // for debugging) without changing any of their underlying behavior:
  //   - isNativeDrawer(el): the shared positive-identification heuristic
  //     (tag/id/class match, explicitly excluding Cart Ninja's own
  //     [data-cart-ninja-drawer] elements first).
  //   - suppress(el): hides a positively-identified native drawer element,
  //     closes it if it's a native <dialog> (removing its ::backdrop and
  //     inert-page side effects), and clears any body/html scroll-lock
  //     side effects the theme applied — all restorable if Cart Ninja's own
  //     drawer fails to open in time.
  //   - config: the tag/id/class-substring/open-class lists driving
  //     detection, kept here purely for visibility (mutating this object
  //     has no effect — the functions above close over the real consts).
  // Runs idempotently: every entry point (click interception, the
  // customElement patch, the <dialog> patch, and the body MutationObserver)
  // already guards against acting twice on the same element/cycle via
  // el._ccNeutralized, so calling into this repeatedly across Add to Cart
  // clicks never creates duplicate listeners, observers, or styles — the
  // listeners/observers themselves are each registered exactly once per
  // page load thanks to the boot guard at the top of this file.
  const NativeCartSuppressor = {
    isNativeDrawer: ccLooksLikeNativeDrawer,
    suppress: ccNeutralizeNativeDrawer,
    config: { tags: CC_DRAWER_TAGS, ids: CC_DRAWER_IDS, openClasses: CC_OPEN_CLASSES },
  };
  window.__CC_NATIVE_CART_SUPPRESSOR__ = NativeCartSuppressor;

  // 9. history.pushState intercept — some themes navigate to /cart instead of opening a drawer.
  // We intercept that and open our drawer instead.
  (function () {
    const _origPush = history.pushState.bind(history);
    history.pushState = function (state, title, url) {
      if (url && (String(url) === '/cart' || String(url).match(/\/cart(\?.*)?$/))) {
        scheduleOpenDrawer(300);
        return;
      }
      return _origPush(state, title, url);
    };
    const _origReplace = history.replaceState.bind(history);
    history.replaceState = function (state, title, url) {
      if (url && (String(url) === '/cart' || String(url).match(/\/cart(\?.*)?$/))) {
        scheduleOpenDrawer(300);
        return;
      }
      return _origReplace(state, title, url);
    };
  })();

  ccWatchCartCount();
  document.addEventListener('DOMContentLoaded', ccWatchCartCount);
  // Exposed so the boot guard above can trigger a re-scan if this script
  // tag itself gets re-executed (e.g. full section HTML replacement),
  // without re-registering any delegated listener.
  window.__CC_REBIND__ = ccWatchCartCount;
  window.addEventListener('load', ccWatchCartCount);
  sendSessionPing();

  /* =================== EVENT TRACKING =================== */

  async function sendClickEvent(eventType) {
    try {
      // Attempt to get shop_id. If not available in CONFIG, use null.
      const shopId = CONFIG?.id || null;
      const payload = {
        shop_id: shopId,
        domain: SHOP,
        event_type: eventType,
        session_id: CC_SESSION_ID,
      };


      await originalFetch(CLICK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
    }
  }

  async function sendSessionPing() {
    try {
      await originalFetch(SESSION_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          domain: SHOP,
          session_id: CC_SESSION_ID,
          page_type: (document.body && document.body.getAttribute('data-template')) || null,
        }),
      });
    } catch (e) {
    }
  }

  /* =================== CART ACTIONS =================== */

  // Debounce flag to prevent overlapping updates
  let _ccUpdating = false;

  async function updateQuantity(key, quantity) {
    if (_ccUpdating) return;
    _ccUpdating = true;
    try {
      // Optimistic UI: dim the item being changed
      const itemEl = document.querySelector(`[data-item-key="${key}"]`);
      if (itemEl) itemEl.style.opacity = '0.5';

      await originalFetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key, quantity }),
      });
      await renderDrawer();
    } catch (e) {
    } finally {
      _ccUpdating = false;
    }
  }

  async function removeItem(key) {
    await updateQuantity(key, 0);
  }

  async function addToCart(variantId, quantity) {
    try {
      const rawId = String(variantId || '').trim();
      const resolvedId = ccExtractNumericId(rawId) || rawId;
      const res = await originalFetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: resolvedId, quantity: quantity || 1 }] }),
      });
      if (res.ok) {
        setTimeout(() => renderDrawer(), 300);
        setTimeout(() => renderDrawer(), 800);
        return true;
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = String(errData?.description || errData?.message || '').toLowerCase();
        const shouldResolve =
          res.status === 400 ||
          res.status === 404 ||
          res.status === 422 ||
          msg.includes('not found') ||
          msg.includes('cannot find') ||
          msg.includes('no variant') ||
          rawId.includes('gid://shopify/Product/');

        if (shouldResolve) {
          return await resolveAndAddVariant(rawId, quantity);
        }
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  async function resolveAndAddVariant(productId, quantity) {
    try {
      const normalizedProductId = ccExtractNumericId(productId) || String(productId || '').trim();
      if (!normalizedProductId) return false;
      const res = await originalFetch('/products.json?limit=250');
      const data = await res.json();
      const product = (data.products || []).find((p) => String(p.id) === String(normalizedProductId));
      if (product && product.variants && product.variants.length > 0) {
        const resolvedVariantId = product.variants[0].id;
        const addRes = await originalFetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ id: resolvedVariantId, quantity: quantity || 1 }] }),
        });
        if (addRes.ok) {
          setTimeout(() => renderDrawer(), 300);
          setTimeout(() => renderDrawer(), 800);
          return true;
        }
        return false;
      }

      // Fallback: try the ID directly as a variant id
      const addRes = await originalFetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: normalizedProductId, quantity: quantity || 1 }] }),
      });
      if (addRes.ok) {
        setTimeout(() => renderDrawer(), 300);
        setTimeout(() => renderDrawer(), 800);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function ccCopyTextFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
  }

  function applyCoupon(code) {
    if (!code) return;
    // Copy to clipboard
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(null, () => ccCopyTextFallback(code));
      } else {
        ccCopyTextFallback(code);
      }
    } catch (e) {
      ccCopyTextFallback(code);
    }
    // Toggle applied state so checkout URL picks it up
    if (appliedCouponCodes.includes(code)) {
      appliedCouponCodes = appliedCouponCodes.filter(c => c !== code);
    } else {
      appliedCouponCodes = [code];
    }
    _lastCopiedCode = code;
    setTimeout(() => {
      if (_lastCopiedCode === code) {
        _lastCopiedCode = null;
        renderDrawer();
      }
    }, 2000);

    sendClickEvent('coupon_click');
    renderDrawer();
  }

  /* =================== SCROLL HELPERS =================== */

  function ccScrollContainer(containerId, direction) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const computed = window.getComputedStyle(el);
    const gapRaw = computed.gap || computed.columnGap || computed.rowGap || '0px';
    const gap = parseFloat(String(gapRaw).split(' ')[0]) || 0;

    const canScrollX = el.scrollWidth - el.clientWidth > 5;
    const canScrollY = el.scrollHeight - el.clientHeight > 5;

    const firstCard = el.querySelector('.cc-upsell-card');

    // Vertical (column) carousel uses the same left/right buttons for up/down.
    if (canScrollY && !canScrollX) {
      let delta = 280;
      if (firstCard) {
        const h = firstCard.getBoundingClientRect().height;
        delta = Math.max(40, Math.round(h + gap));
      }
      el.scrollBy({ top: direction === 'left' ? -delta : delta, behavior: 'smooth' });
      return;
    }

    // Horizontal (row) carousel
    let delta = 290;
    if (firstCard) {
      const w = firstCard.getBoundingClientRect().width;
      delta = Math.max(40, Math.round(w + gap));
    }
    el.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' });
  }

  /* ---- Coupon carousel: move exactly one card per click ---- */
  function ccCouponNav(direction) {
    const el = document.getElementById('cc-coupon-list');
    if (!el) return;
    const card = el.querySelector('[data-coupon-card]');
    if (!card) return;
    // card width + gap (12px)
    const cardWidth = card.offsetWidth + 12;
    el.scrollBy({ left: direction === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' });
  }

  /* =================== PROGRESS HELPERS =================== */

  function getProgressInfo(cartTotal, cartQty, progress) {
    const mode = progress.mode;
    const currentVal = mode === 'quantity' ? cartQty || 0 : cartTotal || 0;
    const tiers = progress.tiers || [];

    // Use the maxTarget already computed by parseProgressData (which derives
    // it from the highest tier). Guaranteed to be > 0.
    const maxTarget = progress.maxTarget || 1000;

    const completed = tiers.filter((t) => currentVal >= t.target);
    const upcoming = tiers.find((t) => t.target > currentVal);
    const nextAmount = upcoming ? upcoming.target - currentVal : 0;

    // Guard against NaN: ensure percentage is always a valid number
    let percentage = maxTarget > 0 ? (currentVal / maxTarget) * 100 : 0;
    if (isNaN(percentage) || !isFinite(percentage)) percentage = 0;
    percentage = Math.min(100, Math.max(0, percentage));


    return { currentVal, maxTarget, completed, upcoming, nextAmount, percentage, mode, tiers };
  }

  // Auto-adds each completed tier's reward product(s) to the cart, and
  // removes any previously auto-added reward product whose tier the cart has
  // dropped back below. Line items we add carry a `_brixReward` property so
  // they can be told apart from anything the shopper added themselves —
  // removal only ever touches lines carrying that marker.
  //
  // First automatic (non-click-triggered) cart mutation in this codebase —
  // guarded by _ccRewardSyncInFlight so overlapping renderDrawer() polls
  // (this runs on every one) can't fire duplicate /cart calls, and by
  // comparing against actual cart contents (not a flag) so it's idempotent
  // across reloads/tabs rather than relying on remembered state.
  async function syncRewardProducts(cart, pInfo) {
    if (_ccRewardSyncInFlight) return;

    const wantedProductIds = new Set();
    (pInfo.completed || []).forEach((tier) => {
      (tier.products || []).forEach((pid) => {
        const numId = ccExtractNumericId(pid);
        if (numId) wantedProductIds.add(numId);
      });
    });

    const presentProductIds = new Set((cart.items || []).map((it) => String(it.product_id)));
    const rewardLines = (cart.items || []).filter((it) => it.properties && it.properties._brixReward === 'true');

    const toAdd = [...wantedProductIds].filter((pid) => !presentProductIds.has(pid));
    const toRemove = rewardLines.filter((it) => !wantedProductIds.has(String(it.product_id)));

    if (toAdd.length === 0 && toRemove.length === 0) return;

    _ccRewardSyncInFlight = true;
    try {
      for (const line of toRemove) {
        await originalFetch('/cart/change.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: line.key, quantity: 0 }),
        }).catch((err) => console.error('[CartDrawer] reward product removal failed:', err));
      }

      if (toAdd.length > 0) {
        const storeCatalog = await ccGetStoreCatalog();
        const items = [];
        toAdd.forEach((pid) => {
          const detail = storeCatalog && storeCatalog.detailsById && storeCatalog.detailsById[pid];
          const variantId = detail && detail.variantId;
          if (variantId) {
            items.push({ id: Number(variantId), quantity: 1, properties: { _brixReward: 'true' } });
          }
        });
        if (items.length > 0) {
          await originalFetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          }).catch((err) => console.error('[CartDrawer] reward product add failed:', err));
        }
      }
    } finally {
      _ccRewardSyncInFlight = false;
    }

    // Cart state changed underneath the render already in progress — refresh
    // once it settles, same delayed-re-render pattern the add-to-cart click
    // handler already uses.
    setTimeout(() => { renderDrawer(); }, 300);
  }

  // gift/shipping/star/trophy are the exact @shopify/polaris-icons paths
  // (GiftCardFilledIcon, DeliveryFilledIcon, StarFilledIcon, RewardIcon) used
  // by the admin's ProgressBarPreview TIER_ICON_MAP — kept in lockstep so a
  // tier's icon looks identical between the editor's live preview and the
  // storefront, not just a same-category stand-in.
  const CC_ICON_PRESETS = {
    gift: '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M7.835 9.5h-.96c-.343 0-.625-.28-.625-.628 0-.344.28-.622.619-.622.242 0 .463.142.563.363l.403.887Z"/><path d="M10.665 9.5h.96c.343 0 .625-.28.625-.628 0-.344-.28-.622-.619-.622-.242 0-.463.142-.563.363l-.403.887Z"/><path fill-rule="evenodd" d="M8.5 4h-3.25c-1.519 0-2.75 1.231-2.75 2.75v2.25h1.25c.414 0 .75.336.75.75s-.336.75-.75.75h-1.25v2.75c0 1.519 1.231 2.75 2.75 2.75h3.441c-.119-.133-.191-.308-.191-.5v-2c0-.414.336-.75.75-.75s.75.336.75.75v2c0 .192-.072.367-.191.5h4.941c1.519 0 2.75-1.231 2.75-2.75v-2.75h-2.75c-.414 0-.75-.336-.75-.75s.336-.75.75-.75h2.75v-2.25c0-1.519-1.231-2.75-2.75-2.75h-4.75v2.25c0 .414-.336.75-.75.75s-.75-.336-.75-.75v-2.25Zm.297 3.992c-.343-.756-1.097-1.242-1.928-1.242-1.173 0-2.119.954-2.119 2.122 0 1.171.95 2.128 2.125 2.128h.858c-.595.51-1.256.924-1.84 1.008-.41.058-.694.438-.635.848.058.41.438.695.848.636 1.11-.158 2.128-.919 2.803-1.53.121-.11.235-.217.341-.322.106.105.22.213.34.322.676.611 1.693 1.372 2.804 1.53.41.059.79-.226.848-.636.059-.41-.226-.79-.636-.848-.583-.084-1.244-.498-1.839-1.008h.858c1.176 0 2.125-.957 2.125-2.128 0-1.168-.946-2.122-2.119-2.122-.83 0-1.585.486-1.928 1.242l-.453.996-.453-.996Z"/></svg>',
    shipping:
      '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M4.75 4.5a.75.75 0 0 0 0 1.5h3.25a1 1 0 0 1 0 2h-4.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 0 0 1.5h.458a2.5 2.5 0 1 0 4.78.75h3.024a2.5 2.5 0 1 0 4.955-.153 1.75 1.75 0 0 0 1.033-1.597v-1.22a1.75 1.75 0 0 0-1.326-1.697l-1.682-.42a.25.25 0 0 1-.18-.174l-.426-1.494a2.75 2.75 0 0 0-2.645-1.995h-6.991Zm2.75 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm8 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    discount:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>',
    star: '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path d="M11.128 4.123c-.453-.95-1.803-.95-2.256 0l-1.39 2.912-3.199.421c-1.042.138-1.46 1.422-.697 2.146l2.34 2.222-.587 3.172c-.192 1.034.901 1.828 1.825 1.327l2.836-1.54 2.836 1.54c.924.501 2.017-.293 1.825-1.327l-.587-3.172 2.34-2.222c.762-.724.345-2.008-.697-2.146l-3.2-.421-1.389-2.912Z"/></svg>',
    trophy:
      '<svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20"><path fill-rule="evenodd" d="M9.716 14.806c.035.005.07.008.106.011l1.4 2.44c.378.66 1.324.673 1.72.024l.479-.781h1.226c.772 0 1.253-.837.864-1.504l-1.167-2c.446-.476.67-1.16.504-1.88-.056-.237.046-.482.252-.61 1.3-.81 1.3-2.702 0-3.511-.206-.128-.308-.374-.252-.61.346-1.491-.992-2.83-2.483-2.482-.236.055-.482-.047-.61-.253-.81-1.3-2.7-1.3-3.51 0-.128.206-.374.308-.61.253-1.492-.347-2.83.99-2.482 2.482.055.236-.047.482-.253.61-1.3.81-1.3 2.7 0 3.51.206.128.308.374.253.61-.135.577-.017 1.131.265 1.573l-1.346 2.308c-.39.667.092 1.504.863 1.504h1.164l.55.825c.415.623 1.342.585 1.706-.07l1.361-2.45Zm-1.31-.73c-.058-.07-.111-.146-.161-.226-.128-.206-.374-.307-.61-.252-.35.08-.69.07-1.003-.014l-.826 1.416h.56c.335 0 .647.167.832.445l.244.365.964-1.735Zm4.582-.428.789 1.352h-.637c-.348 0-.671.181-.853.478l-.184.301-.807-1.407c.174-.141.33-.315.46-.522.127-.206.373-.307.61-.252.211.049.42.064.622.05Zm-3.47-.59c.222.356.742.356.964 0 .468-.752 1.361-1.122 2.223-.921.41.095.777-.273.681-.682-.2-.862.17-1.756.921-2.223.357-.222.357-.742 0-.964-.75-.467-1.121-1.361-.92-2.223.095-.41-.273-.777-.682-.681-.862.2-1.755-.17-2.223-.921-.222-.357-.742-.357-.964 0-.467.75-1.361 1.121-2.223.92-.41-.095-.777.273-.681.682.2.862-.17 1.756-.921 2.223-.357.222-.357.742 0 .964.75.467 1.121 1.361.92 2.223-.095.41.273.777.682.681.862-.2 1.756.17 2.223.921Z"/></svg>',
    heart:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    diamond:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 3H5L2 9l10 12L22 9l-3-6zM9.62 8l1.5-3h1.76l1.5 3H9.62zM11 10v6.68L5.44 10H11zm2 0h5.56L13 16.68V10zM19.26 8h-2.65l-1.5-3h2.65l1.5 3zM6.24 5h2.65l-1.5 3H4.74l1.5-3z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.89 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
  };

  function getMilestoneIconHtml(tier, fillColor) {
    let svg = '';
    if (tier.iconType === 'custom' && tier.iconCustomSvg) {
      svg = tier.iconCustomSvg;
    } else {
      svg = CC_ICON_PRESETS[tier.iconPreset] || CC_ICON_PRESETS.gift;
    }
    // Replace currentColor with explicit fill/stroke so icons are always visible
    if (fillColor) {
      svg = svg.replace(/fill="currentColor"/g, 'fill="' + fillColor + '"');
      svg = svg.replace(/stroke="currentColor"/g, 'stroke="' + fillColor + '"');
      svg = svg.replace(/fill:\s*currentColor/g, 'fill: ' + fillColor);
      svg = svg.replace(/stroke:\s*currentColor/g, 'stroke: ' + fillColor);
    }
    return svg;
  }

  /* =================== CHECKOUT BUTTON (standard / swipe / animated) =================== */

  function renderCheckoutButton(appliedCouponCodes) {
    const cbStyle = CONFIG.checkoutButtonStyle || {};
    const bg = cbStyle.backgroundColor || '#111827';
    const fg = cbStyle.textColor || '#ffffff';
    const radius = cbStyle.borderRadius !== undefined ? cbStyle.borderRadius : 12;
    // Shared by every mode below — guarantees the animated/swipe buttons can
    // never diverge from standard's checkout URL/discount-param behavior.
    const href = appliedCouponCodes && appliedCouponCodes.length > 0
      ? '/checkout?discount=' + encodeURIComponent(appliedCouponCodes[0])
      : '/checkout';

    const isMobile = window.innerWidth <= 480;
    const isSwipe = cbStyle.mobileButtonType === 'swipe' && isMobile;
    // Unlike swipe (a mobile-only drag gesture), the animated tap effect
    // also applies on desktop — the button is still a normal tap/click there.
    const isAnimated = cbStyle.mobileButtonType === 'animated';

    if (isSwipe) {
      const thumbRadius = Math.max(radius - 2, 4);
      return `
  <div id="cc-swipe-track" data-href="${href}" style="position:relative;width:100%;height:52px;background:${bg};border-radius:${radius}px;overflow:hidden;touch-action:pan-y;user-select:none;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
    <span id="cc-swipe-label" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${fg};font-size:13px;font-weight:700;letter-spacing:0.3px;pointer-events:none;">${escapeHtml(CONFIG.checkoutName || 'Swipe to checkout')} →</span>
    <div id="cc-swipe-thumb" style="position:absolute;top:3px;left:3px;width:46px;height:46px;border-radius:${thumbRadius}px;background:rgba(255,255,255,0.95);display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.2);cursor:grab;touch-action:none;">
      <span style="color:${bg};font-size:20px;line-height:1;">›</span>
    </div>
  </div>`;
    }

    if (isAnimated) {
      return `
  <button type="button" id="cc-animated-checkout-btn" class="cc-anim-btn" data-href="${href}" style="position:relative;overflow:hidden;width:100%;padding:16px;background:${bg};color:${fg};border:none;border-radius:${radius}px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);">
    <span id="cc-animated-checkout-spinner" style="display:none;width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,0.4);border-top-color:${fg};animation:cc-anim-spin 0.6s linear infinite;flex-shrink:0;"></span>
    <span id="cc-animated-checkout-label" aria-live="polite">${escapeHtml(CONFIG.checkoutName || 'Checkout')}</span>
  </button>`;
    }

    return `
  <a href="${href}" style="text-decoration:none;" onclick="ccSendClickEvent('checkout_click')">
    <button style="width:100%;padding:16px;background:${bg};color:${fg};border:none;border-radius:${radius}px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);transition:all .2s ease;">
      ${escapeHtml(CONFIG.checkoutName || 'Checkout Now')} <span style="font-size:18px;">→</span>
    </button>
  </a>`;
  }

  // Drag-to-confirm gesture for the swipe checkout button — re-run after
  // every drawer render since the thumb element is recreated each time
  // (innerHTML replace), so any previously-bound listeners are gone with it.
  function initSwipeCheckout() {
    const track = document.getElementById('cc-swipe-track');
    const thumb = document.getElementById('cc-swipe-thumb');
    if (!track || !thumb) return;
    const label = document.getElementById('cc-swipe-label');
    const href = track.getAttribute('data-href');
    const maxX = Math.max(track.clientWidth - thumb.offsetWidth - 6, 1);
    let startX = 0;
    let currentX = 0;
    let dragging = false;
    let committed = false;

    function setX(x) {
      currentX = Math.max(0, Math.min(x, maxX));
      thumb.style.transform = 'translateX(' + currentX + 'px)';
      if (label) label.style.opacity = String(Math.max(0, 1 - currentX / maxX));
    }

    function onStart(clientX) {
      if (committed) return;
      dragging = true;
      startX = clientX - currentX;
      thumb.style.transition = 'none';
    }

    function onMove(clientX) {
      if (!dragging || committed) return;
      setX(clientX - startX);
    }

    function onEnd() {
      if (!dragging || committed) return;
      dragging = false;
      thumb.style.transition = 'transform 0.25s ease';
      if (currentX >= maxX * 0.8) {
        committed = true;
        setX(maxX);
        track.style.opacity = '0.7';
        try { window.ccSendClickEvent('checkout_click'); } catch (e) {}
        window.location.href = href;
      } else {
        setX(0);
      }
    }

    thumb.addEventListener('touchstart', function (e) { onStart(e.touches[0].clientX); }, { passive: true });
    thumb.addEventListener('touchmove', function (e) { onMove(e.touches[0].clientX); }, { passive: true });
    thumb.addEventListener('touchend', onEnd);
    thumb.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return; // handled by touch* listeners above
      try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
      onStart(e.clientX);
    });
    thumb.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') onMove(e.clientX); });
    thumb.addEventListener('pointerup', function (e) { if (e.pointerType !== 'touch') onEnd(); });
    thumb.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'touch') onEnd(); });
  }

  // Tap-triggered press/ripple -> "Processing..." -> "<label>" -> navigate
  // sequence for the animated checkout button — same re-bind-every-render
  // rationale as initSwipeCheckout above (the button is destroyed/recreated
  // via innerHTML each render, so a fresh bind is correct and old listeners
  // are already gone with the old element). No-op if the element isn't in
  // this render's DOM (mode isn't 'animated', or desktop width).
  function initAnimatedCheckout() {
    const btn = document.getElementById('cc-animated-checkout-btn');
    if (!btn) return;
    const label = document.getElementById('cc-animated-checkout-label');
    const spinner = document.getElementById('cc-animated-checkout-spinner');
    const href = btn.getAttribute('data-href');
    const defaultLabel = label ? label.textContent : '';
    let reducedMotion = false;
    try { reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* matchMedia unsupported — treat as no reduced-motion preference */ }

    function reset() {
      btn.dataset.processing = '';
      btn.style.pointerEvents = '';
      btn.classList.remove('cc-anim-pressed');
      if (label) label.textContent = defaultLabel;
      if (spinner) spinner.style.display = 'none';
    }

    function go() {
      try { window.ccSendClickEvent('checkout_click'); } catch (e) { /* analytics beacon failure must never block checkout navigation */ }
      window.location.href = href;
    }

    btn.addEventListener('click', function (e) {
      // Guards against a rapid double-tap/double-activation firing a second
      // checkout navigation — combined with pointer-events:none below, this
      // is what guarantees exactly one checkout action per interaction.
      if (btn.dataset.processing === '1') return;
      btn.dataset.processing = '1';
      btn.style.pointerEvents = 'none';

      try {
        if (!reducedMotion) {
          const rect = btn.getBoundingClientRect();
          const x = (typeof e.clientX === 'number' && e.clientX ? e.clientX : rect.left + rect.width / 2) - rect.left;
          const y = (typeof e.clientY === 'number' && e.clientY ? e.clientY : rect.top + rect.height / 2) - rect.top;
          const ripple = document.createElement('span');
          ripple.className = 'cc-anim-ripple';
          ripple.style.left = x + 'px';
          ripple.style.top = y + 'px';
          btn.appendChild(ripple);
          setTimeout(function () { ripple.remove(); }, 500);
          btn.classList.add('cc-anim-pressed');
        }

        // Processing state starts immediately alongside the press animation
        // — there's no real async call to wait for (standard/swipe also
        // navigate with zero network round-trip before /checkout).
        if (label) label.textContent = 'Processing...';
        if (spinner) spinner.style.display = 'inline-block';

        const pressMs = reducedMotion ? 60 : 280;
        const successMs = reducedMotion ? 60 : 260;

        setTimeout(function () {
          btn.classList.remove('cc-anim-pressed');
          if (label) label.textContent = defaultLabel;
          if (spinner) spinner.style.display = 'none';
          setTimeout(go, successMs);
        }, pressMs);

        // Safety net — never leave the customer stuck on "Processing…" if
        // we're somehow still on this page well after navigation should
        // have already happened.
        setTimeout(function () { if (btn.dataset.processing === '1') reset(); }, 4000);
      } catch (err) {
        // The animation must never block checkout — reset and still go.
        reset();
        go();
      }
    });
  }

  /* =================== RENDER =================== */

  async function renderDrawer() {
    if (!document.getElementById('cc-drawer-styles')) {
      const style = document.createElement('style');
      style.id = 'cc-drawer-styles';
      style.innerHTML = `
        @keyframes cc-fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cc-pop { 0% { transform: scale(0.95); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cc-pulse-ring { 0% { box-shadow: 0 0 0 0 var(--cc-fg-color66); } 70% { box-shadow: 0 0 0 10px rgba(0,0,0,0); } 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } }
        @keyframes cc-drawer-bounce { 0%{transform:translateX(100%)} 65%{transform:translateX(-8px)} 82%{transform:translateX(4px)} 93%{transform:translateX(-2px)} 100%{transform:translateX(0)} }
        @keyframes cc-drawer-zoom { from{transform:translateX(30%) scale(0.88);opacity:0} to{transform:translateX(0) scale(1);opacity:1} }
        #cc-drawer[data-animation="fade"] { transform:none !important; opacity:0; transition:opacity 0.28s ease !important; }
        #cc-overlay.active #cc-drawer[data-animation="fade"] { opacity:1; }
        #cc-overlay.active #cc-drawer[data-animation="bounce"] { animation:cc-drawer-bounce 0.55s cubic-bezier(0.36,0.07,0.19,0.97) both; }
        #cc-drawer[data-animation="zoom"] { transform:none !important; opacity:0; transition:none !important; }
        #cc-overlay.active #cc-drawer[data-animation="zoom"] { animation:cc-drawer-zoom 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards; }
        #cc-drawer[data-animation="push"] { transition:transform 0.4s cubic-bezier(0.77,0,0.175,1) !important; }
        #cc-drawer[data-animation="none"] { transform:none !important; transition:none !important; }
        #cc-announcement-bar { display:block; }
        .cc-anim-btn { transition: transform 0.2s ease; }
        .cc-anim-btn.cc-anim-pressed { transform: scale(0.96); }
        .cc-anim-ripple { position:absolute; width:10px; height:10px; margin-left:-5px; margin-top:-5px; border-radius:50%; background:rgba(255,255,255,0.55); transform:scale(0); animation: cc-anim-ripple-expand 0.5s ease-out forwards; pointer-events:none; }
        @keyframes cc-anim-ripple-expand { to { transform:scale(14); opacity:0; } }
        @keyframes cc-anim-spin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .cc-anim-btn, .cc-anim-btn.cc-anim-pressed { transition:none !important; transform:none !important; }
          .cc-anim-ripple { display:none !important; }
        }
      `;
      document.head.appendChild(style);
    }

    const cart = await originalFetch('/cart.js').then((r) => r.json());
    const cartTotal = cart.total_price / 100;
    const cartQty = cart.item_count;
    const isEmpty = cart.items.length === 0;

    const root = document.getElementById('cc-root');
    let overlay = document.getElementById('cc-overlay');
    const isFirstOpen = !overlay;

    // Save scroll position before re-render
    let savedScroll = 0;
    const existingBody = document.getElementById('cc-drawer-body');
    if (existingBody) savedScroll = existingBody.scrollTop;

    if (isFirstOpen) {
      overlay = document.createElement('div');
      overlay.id = 'cc-overlay';
      // Explicit, unambiguous marker identifying this as Cart Ninja's own
      // drawer — every native-drawer detection/suppression check below
      // excludes anything inside an element carrying this attribute, so
      // Cart Ninja's own drawer can never be mistaken for (and suppressed
      // as) a native one, regardless of what class/id naming coincidences
      // might otherwise overlap.
      overlay.setAttribute('data-cart-ninja-drawer', 'true');
    }

    // Build the drawer inner content (header + body + footer)
    let drawerHtml = '';
    let topBodyHtml = '';
    let bottomBodyHtml = '';

    /* -------- HEADER -------- */
    const hdr = CONFIG.header || {};
    const hdrBg = hdr.bgColor || '#f9fafb';
    const hdrColor = hdr.textColor || '#000000';
    const hdrTitle = hdr.title || 'Your Cart';
    const hdrBorder = hdr.borderBottom !== false ? 'border-bottom:1px solid #e5e7eb;' : '';
    drawerHtml += `
<div style="padding:16px 20px;${hdrBorder}background:${hdrBg};display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
  <h3 style="margin:0;font-size:18px;font-weight:600;color:${hdrColor};">${escapeHtml(hdrTitle)}</h3>
  <button onclick="document.querySelector('#cc-overlay').classList.remove('active');setTimeout(()=>{document.getElementById('cc-root').innerHTML=''},350);"
    style="background:none;border:none;font-size:20px;cursor:pointer;color:${hdrColor};padding:4px;">✕</button>
</div>
`;

    /* -------- ANNOUNCEMENT BAR (below header) -------- */
    const ann = CONFIG.announcement || {};
    if (ann.enabled && ann.text) {
      drawerHtml += `<div id="cc-announcement-bar" style="padding:8px 16px;background:${ann.bgColor || '#4f46e5'};color:${ann.textColor || '#ffffff'};font-size:${ann.fontSize || 14}px;text-align:${ann.textAlign || 'center'};font-weight:${ann.bold ? 700 : 500};font-style:${ann.italic ? 'italic' : 'normal'};flex-shrink:0;">${escapeHtml(ann.text)}</div>`;
    }

    /* -------- COUNTDOWN TIMER BAR (below announcement) -------- */
    const countdown = CONFIG.countdown || {};
    if (countdown.enabled && !isEmpty) {
      drawerHtml += `
<div id="cc-countdown-bar" style="padding:8px 16px;background:${countdown.bgColor};color:${countdown.textColor};font-size:13px;text-align:center;font-weight:600;flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;">
  <span id="cc-countdown-label">${escapeHtml(countdown.label)}</span>
  <span id="cc-countdown-text" style="color:${countdown.accentColor};font-weight:800;letter-spacing:0.5px;"></span>
  ${countdown.couponCode ? `<span style="opacity:0.85;">· Use code <strong>${escapeHtml(countdown.couponCode)}</strong></span>` : ''}
</div>`;
    }

    /* -------- BODY -------- */
    drawerHtml += `<div id="cc-drawer-body" style="flex:1;padding:16px 16px 40px 16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;">`;

    /* ---- PROGRESS BAR ---- */
    const progress = CONFIG.progress;
    if (progress.enabled && (progress.showOnEmpty || !isEmpty)) {
      const pInfo = getProgressInfo(cartTotal, cartQty, progress);
      await syncRewardProducts(cart, pInfo);

      const fgColor = progress.barForegroundColor || '#2563eb';

      let pbHtml = `<div style="padding:8px 16px;margin-bottom:0;position:relative;order:${progress.placement === 'top' ? -2 : 998};">`;
      // Header info
      pbHtml += `<div style="text-align:center;margin-bottom:12px;">`;
      if (pInfo.upcoming) {
        const amountLeft =
          pInfo.mode === 'quantity' ? `${Math.round(pInfo.nextAmount)} items` : `${CURRENCY_SYMBOL}${Math.round(pInfo.nextAmount)}`;
        pbHtml += `
    <p style="margin:0 0 4px 0;font-size:15px;font-weight:500;color:#64748b;">
      You're <span style="color:#0f172a;font-weight:700;">${amountLeft}</span> away
    </p>
    <p style="margin:0;font-size:14px;font-weight:700;color:${fgColor};">
      ${escapeHtml(pInfo.upcoming.rewardText || '')}
    </p>
  `;
      } else {
        pbHtml += `
    <div style="color:${progress.completionTextColor || '#10b981'};display:flex;align-items:center;justify-content:center;gap:8px;animation:cc-pop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;">
      <span style="font-size:16px;font-weight:800;">${progress.completionText}</span>
    </div>
  `;
      }
      pbHtml += `</div>`;

      // ---- PROGRESS TRACK ---- (radius now respects the merchant's
      // configured progress.borderRadius, like CartPreview.jsx's
      // ProgressBarPreview does — it was parsed above but never actually
      // applied here, so the storefront always rendered a fixed pill shape
      // regardless of what was saved.)
      const trackRadius = progress.borderRadius ?? 8;
      pbHtml += `<div style="position:relative;width:calc(100% - 20px);height:8px;margin:8px 10px 48px 10px;background:${progress.barBackgroundColor || '#e2e8f0'
        };border-radius:${trackRadius}px;">`;

      // 1. The progress bar filler
      pbHtml += `<div style="position:absolute;left:0;top:0;height:100%;width:${pInfo.percentage}%;background:${fgColor};border-radius:${trackRadius}px;transition:width 0.3s ease;z-index:1;display:block !important;overflow:hidden;font-size:0;line-height:0;">&nbsp;</div>`;

      // 2. Tier segment markers — thin lines on the track showing where each level is
      pInfo.tiers.forEach((ms) => {
        const segPercent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const reached = pInfo.currentVal >= ms.target;
        pbHtml += `<div style="position:absolute;left:${segPercent}%;top:-3px;width:2px;height:calc(100% + 6px);background:${reached ? fgColor : '#cbd5e180'
          };border-radius:1px;z-index:0;display:block !important;">&nbsp;</div>`;
      });

      // 3. The milestone nodes — mirrors CartPreview.jsx's ProgressBarPreview
      // tier marker exactly: a fixed 24px circle that's outlined in the
      // fill color and turns solid once reached, with a green "REACHED"
      // pill + tier title underneath once unlocked, or a plain amount pill
      // while still locked. Admin has no separate "upcoming" visual state,
      // so isNext only drives the pulse-ring cue (an outward glow animation
      // that doesn't change the node's resting look).
      pInfo.tiers.forEach((ms, idx) => {
        const isCompleted = pInfo.currentVal >= ms.target;
        const prevTarget = idx > 0 ? pInfo.tiers[idx - 1].target : 0;
        const isNext = !isCompleted && pInfo.currentVal >= prevTarget;
        const percent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const iconFill = progress.iconColor || progress.icon_color || fgColor;
        const iconHtml = getMilestoneIconHtml(ms, isCompleted ? '#ffffff' : iconFill);
        const nodeSize = 24;
        const iconSize = 13;

        // Size this tier's label to the gap toward its nearest neighbor so
        // adjacent labels never overlap when tiers are close together in
        // value (a fixed width previously caused dense tier ladders —
        // e.g. $2000/$2500/$3500 — to collide).
        const prevPercent = idx > 0 ? Math.min(97, Math.max(3, (pInfo.tiers[idx - 1].target / pInfo.maxTarget) * 100)) : 0;
        const nextPercent = idx < pInfo.tiers.length - 1 ? Math.min(97, Math.max(3, (pInfo.tiers[idx + 1].target / pInfo.maxTarget) * 100)) : 100;
        const nearestGapPercent = Math.min(percent - prevPercent, nextPercent - percent);
        const APPROX_TRACK_WIDTH_PX = 340; // rough estimate of the track's rendered width, good enough for sizing text
        const labelWidthPx = Math.max(48, Math.min(90, Math.floor((nearestGapPercent / 100) * APPROX_TRACK_WIDTH_PX) - 6));

        pbHtml += `<div style="position:absolute;left:${percent}%;top:50%;transform:translate(-50%,-50%);z-index:3;display:flex;flex-direction:column;align-items:center;">`;

        // Node circle — bordered, fills solid on unlock, exactly like the
        // admin preview's tier marker.
        pbHtml += `<div style="width:${nodeSize}px;height:${nodeSize}px;border-radius:50%;background:${isCompleted ? fgColor : '#ffffff'};border:2px solid ${fgColor};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.15);flex-shrink:0;${isNext ? 'animation:cc-pulse-ring 2s infinite;--cc-fg-color66:' + fgColor + '66;' : ''}">`;
        pbHtml += `<span style="width:${iconSize}px;height:${iconSize}px;display:flex;align-items:center;justify-content:center;line-height:0;">${iconHtml}</span>`;
        pbHtml += `</div>`;

        const amountDisplay = pInfo.mode === 'amount' ? CURRENCY_SYMBOL + Math.round(ms.target) : ms.target + ' items';
        const tierLabel = ms.title || ms.rewardText;

        // Must be position:absolute (top:100%, relative to the node-sized
        // wrapper above) — not stacked in normal flow. The wrapper itself is
        // vertically centered on the track (top:50%/translateY(-50%)); if the
        // label joined the flex column it would count toward the wrapper's
        // height, which pulls that centering point up and drags the label
        // back over the track/badge instead of sitting cleanly below the node.
        pbHtml += `<div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:6px;width:${labelWidthPx}px;display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;">`;
        if (isCompleted) {
          pbHtml += `<div style="font-size:7px;font-weight:700;color:#059669;background:#d1fae5;padding:1px 5px;border-radius:3px;white-space:nowrap;letter-spacing:0.3px;">REACHED</div>`;
          if (tierLabel) {
            pbHtml += `<div style="font-size:8px;color:${iconFill};font-weight:600;white-space:normal;word-break:break-word;line-height:1.25;text-align:center;">${escapeHtml(tierLabel)}</div>`;
          }
        } else {
          pbHtml += `<div style="font-size:9px;color:#374151;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:5px;padding:2px 6px;font-weight:500;white-space:nowrap;">${amountDisplay}</div>`;
        }
        pbHtml += `</div></div>`;
      });

      pbHtml += `</div>`; // end progress track
      pbHtml += `</div>`; // end progress container

      if (progress.placement === 'bottom') bottomBodyHtml += pbHtml;
      else topBodyHtml += pbHtml;

      // Trigger Confetti "Paper Popup" when fully unlocked
      if (!pInfo.upcoming) {
        if (!window._ccConfettiShown && progress.enableConfetti) {
          window._ccConfettiShown = true;
          triggerConfetti();
        }
      } else {
        window._ccConfettiShown = false; // Reset if cart drops below target
      }
    }

    /* ---- COUPON SECTION ---- */
    const coupon = CONFIG.coupon;
    if (coupon.enabled && coupon.selectedActiveCoupons.length > 0) {
      if (coupon.position === 'bottom') bottomBodyHtml += renderCouponSection(coupon, cartTotal);
      else topBodyHtml += renderCouponSection(coupon, cartTotal);
    }

    drawerHtml += topBodyHtml;

    /* ---- EMPTY STATE ---- */
    if (isEmpty) {
      const ec = CONFIG.emptyCart || {};
      drawerHtml += `
  <div style="padding:40px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c9cccf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
    <p style="margin:0;font-size:16px;font-weight:600;color:#111;">${escapeHtml(ec.message || 'Your cart is empty')}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Add items to unlock rewards</p>
    ${ec.showContinueShopping !== false ? `<button onclick="window.location.href=((window.Shopify&&window.Shopify.routes&&window.Shopify.routes.root)||'/')+'collections/all';" style="margin-top:4px;padding:8px 18px;border:1px solid #c9cccf;border-radius:7px;background:#fff;font-size:13px;cursor:pointer;color:#202223;">Continue shopping</button>` : ''}
  </div>
`;
    }

    /* ---- UPSELL (TOP POSITION) ---- */
    const upsell = CONFIG.upsell;
    let topUpsellHtml = '';
    let bottomUpsellHtml = '';

    // Prepare upsell html asynchronously before concatenating
    // Allow render if: AI mode is on OR at least one rule has explicitly configured products
    const hasUpsellProductsConfigured = (upsell.manualRules || []).some(
      rule => (rule.upsellProductIds || []).length > 0
    );
    if (upsell.enabled && (upsell.showOnEmptyCart || !isEmpty) && (upsell.useAI || hasUpsellProductsConfigured)) {
      if (upsell.position === 'top') {
        topUpsellHtml = await renderUpsellSectionAsync(cart, upsell);
      } else if (upsell.position === 'bottom') {
        bottomUpsellHtml = await renderUpsellSectionAsync(cart, upsell);
      }
    }

    if (topUpsellHtml) {
      drawerHtml += topUpsellHtml;
    }

    /* ---- CART ITEMS ---- */
    if (!isEmpty) {
      drawerHtml += `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:0 4px;">
    <p style="margin:0;font-size:15px;font-weight:800;color:#1e293b;letter-spacing:-0.01em;">Items included</p>
    <div style="background:#f1f5f9;padding:2px 8px;border-radius:6px;">
      <span style="font-size:11px;font-weight:700;color:#64748b;">${cart.items.length} ITEMS</span>
    </div>
  </div>
`;

      cart.items.forEach((item) => {
        const price = item.final_line_price / 100;
        const unitPrice = item.original_price / 100;
        const lineTotal = price;

        drawerHtml += `
    <div style="display:flex;gap:12px;padding:12px;background:#fff;border-radius:16px;border:1px solid #f1f5f9;transition:all .3s ease;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);position:relative;">
      <div style="width:70px;height:70px;background:#fff;border-radius:12px;flex-shrink:0;border:1px solid #f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center;">
        ${item.image
            ? `<img src="${item.image}" alt="${escapeHtml(
              item.product_title
            )}" style="width:100%;height:100%;object-fit:contain;">`
            : `<span style="font-size:32px;">📦</span>`
          }
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;white-space:normal;overflow-wrap:anywhere;word-break:break-word;flex:1;">${escapeHtml(
            item.product_title
          )}</p>
          <button onclick="ccRemoveItem('${item.key}')"
            style="background:none;border:none;padding:4px;cursor:pointer;color:#94a3b8;font-size:16px;transition:color .2s;" title="Remove item">✕</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
          <div style="display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:700;color:#0f172a;">${CURRENCY_SYMBOL}${unitPrice.toFixed(0)}</span>
              <span style="font-size:12px;color:#64748b;font-weight:500;">(${item.quantity} × ${CURRENCY_SYMBOL}${unitPrice.toFixed(
            0
          )})</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="display:flex;align-items:center;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;padding:2px;">
              <button class="cc-qty-btn" onclick="ccUpdateQty('${item.key}',${item.quantity - 1})">−</button>
              <span style="width:24px;text-align:center;font-size:13px;font-weight:700;color:#1e293b;">${item.quantity
          }</span>
              <button class="cc-qty-btn" onclick="ccUpdateQty('${item.key}',${item.quantity + 1})">+</button>
            </div>
            <div style="text-align:right;min-width:60px;">
              <span style="font-weight:800;font-size:15px;color:#0f172a;">${CURRENCY_SYMBOL}${lineTotal.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
      });

    }

    /* ---- UPSELL (BOTTOM POSITION) ---- */
    if (bottomUpsellHtml) {
      drawerHtml += bottomUpsellHtml;
    }

    drawerHtml += bottomBodyHtml;
    drawerHtml += `</div>`; // end body

    /* -------- FOOTER -------- */
    const subtotal = cartTotal;
    let totalDiscount = 0;

    // Calculate coupon discounts — check both API data (COUPONS) and saved details (allCouponDetails)
    const allDetails = (CONFIG.coupon && CONFIG.coupon.allCouponDetails) || [];
    appliedCouponCodes.forEach((code) => {
      // 1. Try COUPONS from API
      const apiMatch = COUPONS.find((c) => c.code === code);
      // 2. Try allCouponDetails from saved config
      const savedMatch = allDetails.find((c) => c.code === code);

      let val = 0;
      let isPercentage = false;

      if (apiMatch && (apiMatch.value || apiMatch.discountValue)) {
        val = parseFloat(apiMatch.value || apiMatch.discountValue || 0);
        isPercentage = apiMatch.valueType === 'percentage' || apiMatch.discountType === 'percentage';
      } else if (savedMatch && savedMatch.discountValue) {
        val = parseFloat(savedMatch.discountValue || 0);
        isPercentage = savedMatch.discountType === 'percentage';
      }

      if (val > 0) {
        if (isPercentage) {
          totalDiscount += subtotal * (val / 100);
        } else {
          totalDiscount += val;
        }
      }
    });
    const finalTotal = Math.max(0, subtotal - totalDiscount);

    drawerHtml += `
<div style="padding:20px;background:#fff;border-top:1px solid #f1f5f9;box-shadow:0 -4px 6px -1px rgba(0,0,0,0.05);flex-shrink:0;">
  <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;color:#64748b;font-weight:500;">Subtotal</span>
      <span style="font-size:14px;color:#0f172a;font-weight:700;">${CURRENCY_SYMBOL}${subtotal.toFixed(0)}</span>
    </div>
`;

    if (totalDiscount > 0) {
      drawerHtml += `
    <div style="display:flex;justify-content:space-between;align-items:center;color:#10b981;">
      <span style="font-size:14px;font-weight:500;">Discounts</span>
      <span style="font-size:14px;font-weight:700;">-${CURRENCY_SYMBOL}${totalDiscount.toFixed(0)}</span>
    </div>
`;
    }

    drawerHtml += `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-top:10px;border-top:1px solid #f1f5f9;">
      <span style="font-size:16px;color:#0f172a;font-weight:800;">Total</span>
      <span style="font-size:18px;color:#0f172a;font-weight:900;">${CURRENCY_SYMBOL}${finalTotal.toFixed(0)}</span>
    </div>
  </div>
  ${renderCheckoutButton(appliedCouponCodes)}
  <p style="margin:12px 0 0 0;text-align:center;font-size:11px;color:#94a3b8;font-weight:500;">
    ${escapeHtml(CONFIG.checkoutFooterText || 'Shipping and taxes calculated at checkout')}
  </p>
  ${CONFIG.showWatermark !== false ? `
  <p style="margin:8px 0 0 0;text-align:center;font-size:10px;color:#cbd5e1;font-weight:600;letter-spacing:0.2px;">
    Powered by BRIX
  </p>` : ''}
</div>
`;

    // ---- SMOOTH DOM UPDATE ----
    if (isFirstOpen) {
      // First open: build full overlay with backdrop + drawer
      const drawerAnim = (CONFIG.design && CONFIG.design.animation) || 'slide';
      overlay.innerHTML = `<div id="cc-backdrop"></div><div id="cc-drawer" data-animation="${drawerAnim}">${drawerHtml}</div>`;
      root.appendChild(overlay);
      // Force a synchronous layout flush so the browser paints the closed
      // (translateX/opacity) state before we flip to .active — otherwise
      // the two rAFs can collapse into a single paint and the CSS
      // transition never has a "before" state to animate from, so the
      // drawer just snaps open instead of sliding/fading/etc in.
      void overlay.offsetHeight;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.classList.add('active');
          ccMilestone('Cart Ninja drawer opened');
        });
      });
      document.getElementById('cc-backdrop').addEventListener('click', closeDrawer);
      initSwipeCheckout();
      initAnimatedCheckout();
    } else {
      // Subsequent updates: only replace drawer inner content (no flash)
      const drawer = document.getElementById('cc-drawer');
      if (drawer) {
        drawer.innerHTML = drawerHtml;
      }
      overlay.classList.add('active');
      ccMilestone('Cart Ninja drawer opened');

      // Restore scroll position
      const newBody = document.getElementById('cc-drawer-body');
      if (newBody && savedScroll > 0) {
        newBody.scrollTop = savedScroll;
      }

      // Re-attach backdrop listener
      const backdrop = document.getElementById('cc-backdrop');
      if (backdrop) backdrop.addEventListener('click', closeDrawer);
      initSwipeCheckout();
      initAnimatedCheckout();
    }

    startCountdownTicker();
  }

  /* =================== COUNTDOWN TIMER TICKER =================== */
  // 'session' mode: the deadline resets every browser session (sessionStorage).
  // 'fixed' mode: the deadline is set once per device and persists across
  // sessions until it actually expires (localStorage) — a true one-shot
  // urgency countdown rather than one that quietly resets on every visit.
  function getCountdownDeadline(countdown) {
    const store = countdown.mode === 'fixed' ? window.localStorage : window.sessionStorage;
    const key = 'cc_countdown_deadline_' + SHOP;
    const durationMs = ((countdown.hours || 0) * 3600 + (countdown.minutes || 0) * 60) * 1000;
    if (durationMs <= 0) return null;
    try {
      const stored = parseInt(store.getItem(key) || '0', 10);
      if (stored && stored > Date.now()) return stored;
      const deadline = Date.now() + durationMs;
      store.setItem(key, String(deadline));
      return deadline;
    } catch (e) {
      return Date.now() + durationMs;
    }
  }

  function startCountdownTicker() {
    if (_ccCountdownInterval) {
      clearInterval(_ccCountdownInterval);
      _ccCountdownInterval = null;
    }
    const countdown = CONFIG.countdown || {};
    if (!countdown.enabled) return;
    const deadline = getCountdownDeadline(countdown);
    if (!deadline) return;

    function tick() {
      const textEl = document.getElementById('cc-countdown-text');
      const labelEl = document.getElementById('cc-countdown-label');
      if (!textEl) { clearInterval(_ccCountdownInterval); _ccCountdownInterval = null; return; }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        if (labelEl) labelEl.textContent = countdown.expiredLabel;
        textEl.textContent = '';
        clearInterval(_ccCountdownInterval);
        _ccCountdownInterval = null;
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      const pad = (n) => String(n).padStart(2, '0');
      textEl.textContent = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    tick();
    _ccCountdownInterval = setInterval(tick, 1000);
  }

  /* =================== COUPON SECTION RENDERER =================== */

  function renderCouponSection(couponConfig, cartTotal) {
    const selectedIds = couponConfig.selectedActiveCoupons || [];
    const overrides = couponConfig.couponOverrides || {};
    const savedDetails = couponConfig.allCouponDetails || [];
    const style = couponConfig.style || 'style-2';
    const layout = couponConfig.layout || 'grid';
    const alignment = couponConfig.alignment || 'horizontal';

    const title = couponConfig.title || {};
    const titleText = title.text || 'Apply Coupon';
    const titleFontSize = parseInt(title.fontSize ?? 14, 10) || 14;
    const titleTextColor = title.textColor || '#1e293b';
    const titleAlign = title.alignment === 'center' || title.alignment === 'right' || title.alignment === 'left' ? title.alignment : 'left';

    // Use allCouponDetails from DB as primary source (has all visual styles saved)
    // Fall back to COUPONS API + overrides only if allCouponDetails is empty
    const couponsToShow = selectedIds
      .map((id) => {
        // 1. Check if we have saved details from DB
        const saved = savedDetails.find((d) => d.id === id);
        if (saved) {
          const resolvedCode = saved.code || saved.label || saved.description || '';
          if (!resolvedCode) return null;
          const btn = saved.button || {};
          return {
            id,
            code: resolvedCode,
            label: saved.label || saved.code || 'Coupon',
            description: saved.description || '',
            discountType: saved.discountType || 'percentage',
            discountValue: parseFloat(saved.discountValue || 0),
            backgroundColor: saved.backgroundColor || '#4f46e5',
            textColor: saved.textColor || '#fff',
            iconKey: saved.iconKey || 'discount',
            buttonText: btn.text ?? 'Apply',
            buttonBackgroundColor: btn.backgroundColor ?? '#000000',
            buttonTextColor: btn.textColor ?? '#ffffff',
            borderRadius: saved.borderRadius || 8,
          };
        }

        // 2. Fall back to COUPONS API data + overrides
        const apiCoupon = COUPONS.find((c) => (c.internal_id || c.id) === id);
        const override = overrides[id] || {};
        if (apiCoupon) {
          return {
            id,
            code: override.code || apiCoupon.code || 'CODE',
            label: override.label || apiCoupon.title || apiCoupon.code || 'Coupon',
            description:
              override.description ||
              apiCoupon.discount_config?.description ||
              (apiCoupon.type === 'amount_off_order' || apiCoupon.discount_config?.type === 'amount_off_order'
                ? 'Order Discount'
                : 'Product Discount'),
            discountType: apiCoupon.valueType === 'percentage' ? 'percentage' : 'fixed',
            discountValue: parseFloat(override.discountValue || apiCoupon.value || 0),
            backgroundColor: override.backgroundColor || apiCoupon.backgroundColor || '#6366f1',
            textColor: override.textColor || apiCoupon.textColor || '#ffffff',
            iconKey: override.iconKey || apiCoupon.iconKey || apiCoupon.icon || 'discount',
            buttonText:
              override['button.text'] ??
              override.button?.text ??
              apiCoupon.buttonText ??
              apiCoupon.discount_config?.button?.text ??
              apiCoupon.button?.text ??
              'Apply',
            buttonBackgroundColor:
              override['button.backgroundColor'] ??
              override.button?.backgroundColor ??
              apiCoupon.buttonBackgroundColor ??
              apiCoupon.button?.backgroundColor ??
              '#000000',
            buttonTextColor:
              override['button.textColor'] ??
              override.button?.textColor ??
              apiCoupon.buttonTextColor ??
              apiCoupon.button?.textColor ??
              '#ffffff',
            borderRadius: override.borderRadius || apiCoupon.borderRadius || 8,
          };
        }

        // 3. Minimal fallback using only overrides
        return {
          id,
          code: override.code || 'CODE',
          label: override.label || override.headingText || 'Coupon',
          description: override.description || override.subtextText || 'Discount',
          discountType: 'percentage',
          discountValue: parseFloat(override.discountValue || 0),
          backgroundColor: override.backgroundColor || '#6366f1',
          textColor: override.textColor || '#ffffff',
          iconUrl: override.iconUrl || '🎟️',
          buttonText: override['button.text'] ?? override.button?.text ?? 'Apply',
          buttonBackgroundColor:
            override['button.backgroundColor'] ?? override.button?.backgroundColor ?? '#000000',
          buttonTextColor: override['button.textColor'] ?? override.button?.textColor ?? '#ffffff',
          borderRadius: override.borderRadius || 8,
        };
      })
      .filter((c) => c);

    if (couponsToShow.length === 0) return '';

    /* -- Coupon list is a horizontal carousel so nav arrows work, unless -- */
    /* -- there's only one coupon, in which case it's positioned per the -- */
    /* -- merchant's chosen single-coupon alignment.                     -- */
    const couponListStyle = couponsToShow.length === 1
      ? `display:flex;flex-direction:row;gap:12px;justify-content:${{ left: 'flex-start', center: 'center', right: 'flex-end' }[couponConfig.singleCouponAlignment] || 'flex-start'};padding:0 4px 20px 4px;`
      : 'display:flex;flex-direction:row;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-ms-overflow-style:none;scrollbar-width:none;padding:0 4px 20px 4px;';

    let html = `
<div style="padding:16px;background:#fff;order:${couponConfig.position === 'top' ? -1 : 999};">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <p style="margin:0;font-size:${titleFontSize}px;font-weight:700;color:${titleTextColor};text-align:${titleAlign};flex:1;">${escapeHtml(titleText)}</p>
    <div style="display:flex;gap:6px;">
      <button class="cc-nav-btn" onclick="ccCouponNav('left')" title="Previous coupon">←</button>
      <button class="cc-nav-btn" onclick="ccCouponNav('right')" title="Next coupon">→</button>
    </div>
  </div>
  <div id="cc-coupon-list" class="cc-hide-scrollbar" style="${couponListStyle}">
`;

    couponsToShow.forEach((coupon) => {

      if (style === 'style-1') {
        // minimal-card: white bg, colored left border, small svg icon, outline button
        const baseColor = coupon.backgroundColor || '#4f46e5';
        const borderR = coupon.borderRadius || 8;
        const btnLabel = coupon.code === _lastCopiedCode ? 'Copied' : (!coupon.buttonText || coupon.buttonText === 'Apply' ? 'Copy' : coupon.buttonText);
        const iconSvg = ccIconSvg(coupon.iconKey, 14, baseColor);
        html += `
    <div data-coupon-card class="cc-coupon-card" style="width:132px;flex-shrink:0;scroll-snap-align:start;padding:10px 9px;background:#fff;border:1px solid #e5e7eb;border-left:3px solid ${baseColor};border-radius:${borderR}px;display:flex;flex-direction:column;gap:5px;box-sizing:border-box;height:100%;">
      <div style="display:flex;align-items:center;gap:5px;overflow:hidden;">
        <span style="color:${baseColor};display:flex;line-height:0;flex-shrink:0;">${iconSvg}</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(coupon.label || coupon.code)}</span>
      </div>
      <div style="font-size:9px;opacity:0.85;line-height:1.3;">${escapeHtml(coupon.description || '')}</div>
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="margin-top:auto;align-self:center;padding:3px 4px;border-radius:4px;border:1px solid ${coupon.code === _lastCopiedCode ? '#10b981' : baseColor};background:${coupon.code === _lastCopiedCode ? '#10b981' : 'transparent'};color:${coupon.code === _lastCopiedCode ? '#fff' : baseColor};font-size:8px;font-weight:600;cursor:pointer;width:68%;text-align:center;">
        ${escapeHtml(btnLabel)}
      </button>
    </div>
  `;
      } else if (style === 'style-2') {
        // bold-vibrant: full colored bg, centered, svg icon (textColor), bold labelText, button
        const bg = coupon.backgroundColor || '#4f46e5';
        const tc = coupon.textColor || '#ffffff';
        const btnBg = coupon.code === _lastCopiedCode ? '#10b981' : (coupon.buttonBackgroundColor || '#000000');
        const btnTc = coupon.code === _lastCopiedCode ? '#fff' : (coupon.buttonTextColor || '#ffffff');
        const btnLabel = coupon.code === _lastCopiedCode ? 'Copied!' : (!coupon.buttonText || coupon.buttonText === 'Apply' ? 'Copy' : coupon.buttonText);
        const borderR = coupon.borderRadius || 8;
        const iconSvg = ccIconSvg(coupon.iconKey, 20, tc);
        html += `
    <div data-coupon-card class="cc-coupon-card" style="width:132px;flex-shrink:0;scroll-snap-align:start;padding:10px 8px;background:${bg};border-radius:${borderR}px;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;box-shadow:0 2px 8px ${bg}55;box-sizing:border-box;height:100%;">
      <span style="color:${tc};display:flex;line-height:0;">${iconSvg}</span>
      <div style="font-size:11px;font-weight:800;color:${tc};letter-spacing:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;">${escapeHtml(coupon.label || coupon.code)}</div>
      ${coupon.description ? `<div style="font-size:8px;color:${tc};opacity:0.85;line-height:1.3;flex:1;">${escapeHtml(coupon.description)}</div>` : ''}
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="margin-top:auto;padding:3px 6px;border-radius:4px;border:none;background:${btnBg};color:${btnTc};font-size:8px;font-weight:700;cursor:pointer;width:68%;text-align:center;letter-spacing:0.5px;">
        ${escapeHtml(btnLabel)}
      </button>
    </div>
  `;
      } else {
        // classic-banner: full colored bg, svg icon (textColor) + labelText + description, button right
        const bg = coupon.backgroundColor || '#4f46e5';
        const tc = coupon.textColor || '#ffffff';
        const btnBg = coupon.code === _lastCopiedCode ? '#10b981' : (coupon.buttonBackgroundColor || '#000000');
        const btnTc = coupon.code === _lastCopiedCode ? '#fff' : (coupon.buttonTextColor || '#ffffff');
        const btnLabel = coupon.code === _lastCopiedCode ? 'Copied' : (!coupon.buttonText || coupon.buttonText === 'Apply' ? 'Copy' : coupon.buttonText);
        const borderR = coupon.borderRadius || 8;
        const iconSvg = ccIconSvg(coupon.iconKey, 14, tc);
        html += `
    <div data-coupon-card class="cc-coupon-card" style="width:132px;flex-shrink:0;scroll-snap-align:start;padding:10px 9px;background:${bg};color:${tc};border-radius:${borderR}px;display:flex;flex-direction:column;gap:5px;box-sizing:border-box;height:100%;">
      <div style="display:flex;align-items:flex-start;gap:5px;">
        <span style="color:${tc};display:flex;line-height:0;flex-shrink:0;">${iconSvg}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(coupon.label || coupon.code)}</div>
          <div style="font-size:9px;opacity:0.85;line-height:1.3;">${escapeHtml(coupon.description || '')}</div>
        </div>
      </div>
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="margin-top:auto;align-self:center;padding:3px 4px;border-radius:4px;border:none;background:${btnBg};color:${btnTc};font-size:8px;font-weight:600;cursor:pointer;width:60%;text-align:center;">
        ${escapeHtml(btnLabel)}
      </button>
    </div>
  `;
      }
    });

    html += `</div></div>`;
    return html;
  }

  /* =================== UPSELL SECTION RENDERER =================== */

  async function renderUpsellSectionAsync(cart, upsellConfig) {
    const cartProductIds = cart.items.map(item => String(item.product_id));
    let upsellProducts = [];
    let matchedUpsellDetails = [];
    let storeDetailsById = null;


    if (upsellProducts.length === 0 && upsellConfig.manualRules) {
      for (const rule of upsellConfig.manualRules) {
        if (rule.enabled === false) continue;
        const triggerIds = (rule.triggerProductIds || []).map(id => String(id).replace('gid://shopify/Product/', ''));
        // When specific trigger products are set, they MUST be in the cart.
        // triggerType='all' only acts as a global rule when NO trigger products are configured.
        const hasSpecificTriggers = triggerIds.length > 0;
        // On an empty cart with "show on empty" enabled, there's no trigger product to
        // match against — so show the rule's configured products regardless of trigger.
        const cartIsEmpty = cartProductIds.length === 0;
        const triggerMatches = (cartIsEmpty && upsellConfig.showOnEmptyCart)
          ? true
          : hasSpecificTriggers
            ? triggerIds.some(id => cartProductIds.includes(id))
            : rule.triggerType === 'all';
        if (triggerMatches) {
          (rule.upsellProductIds || []).forEach((id, idx) => {
            const pId = String(id).replace('gid://shopify/Product/', '');
            if (!upsellProducts.includes(pId)) {
              upsellProducts.push(pId);
              if (rule.upsellProductDetails?.[idx]) matchedUpsellDetails.push(rule.upsellProductDetails[idx]);
            }
          });
        }
      }
    }

    // Ensure we have a full store catalog fallback so AI/manual
    // recommendations can always be enriched with real title/image/price.
    if (!storeDetailsById) {
      const storeCatalog = await ccGetStoreCatalog();
      if (storeCatalog && storeCatalog.detailsById) {
        storeDetailsById = storeCatalog.detailsById;
      }
    }

    // Apply storefront conditions (match cart_drawer.js behavior)
    if (!upsellConfig.showIfInCart) {
      upsellProducts = upsellProducts.filter((id) => !cartProductIds.includes(String(id)));
    }
    // Only cap by the global limit in AI mode. Manual rules show every product the
    // merchant explicitly selected (selecting 3 products should display all 3).
    if (upsellConfig.limit && upsellConfig.useAI) {
      const parsedLimit = Number.parseInt(String(upsellConfig.limit), 10);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        upsellProducts = upsellProducts.slice(0, parsedLimit);
      }
    }
    if (upsellProducts.length === 0) return '';

    // Pre-filter: remove products that can't be resolved from the store catalog
    // and have no valid saved title — prevents rendering empty placeholder cards
    upsellProducts = upsellProducts.filter((productId) => {
      const resolvedFromStore = storeDetailsById && !!storeDetailsById[String(productId)];
      if (resolvedFromStore) return true;
      const detail = (matchedUpsellDetails || []).find(
        (d) => String(d.id).replace('gid://shopify/Product/', '') === productId ||
               String(d.id).includes(productId)
      );
      return detail && detail.title && detail.title.trim() !== '' && detail.title !== 'Product';
    });

    if (upsellProducts.length === 0) return '';

    // The admin builder's live preview colors the upsell "Add" button using
    // the checkout button's style (CartPreview.jsx's UpsellPreview), not a
    // separate hardcoded color — match that here instead of the plain black
    // .cc-add-btn default.
    const addBtnCbStyle = CONFIG.checkoutButtonStyle || {};
    const addBtnBg = addBtnCbStyle.backgroundColor || '#111827';
    const addBtnFg = addBtnCbStyle.textColor || '#ffffff';

    const dir = upsellConfig.direction || 'vertical';
    const layout = upsellConfig.layout || 'carousel';
    const titleStyle = `
      font-size:16px;
      font-weight:${upsellConfig.upsellTitle.bold ? 900 : 600};
      font-style:${upsellConfig.upsellTitle.italic ? 'italic' : 'normal'};
      text-decoration:${upsellConfig.upsellTitle.underline ? 'underline' : 'none'};
      color:${upsellConfig.upsellTitle.color};
    `;

    const isHorizontal = dir === 'horizontal';
    const isVertical = dir === 'vertical';
    const isCarousel = layout === 'carousel';
    const isGrid = layout === 'grid';
    const showUpsellNav = upsellProducts.length >= 2 && isCarousel;

    const navPrevSymbol = '←';
    const navNextSymbol = '→';
    const navPrevTitle = 'Scroll left';
    const navNextTitle = 'Scroll right';

    // --- Container Styles based on Layout AND Direction ---
    let listStyle = `display: ${isGrid ? 'grid' : 'flex'}; gap: ${isCarousel && isVertical ? '14px' : '12px'}; scroll-behavior: smooth;`;

    if (isGrid) {
      // GRID: Uses CSS Grid for strict 1 or 2 column distribution
      listStyle += `grid-template-columns: ${isHorizontal ? 'repeat(2, 1fr)' : 'repeat(1, 1fr)'};`;
      if (isVertical) {
        listStyle += `justify-items: start;`;
      }
    } else {
      // CAROUSEL: always scrolls horizontally as a row of fixed-size cards —
      // a vertically-stacked full-width list doesn't read as a carousel.
      // "direction" now only changes card width/density (see card markup
      // below), not the scroll axis.
      listStyle += `flex-direction: row; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x proximity; cursor: grab;`;
    }

    let html = `
<div style="padding:16px 20px;background:#f8fafc;border-bottom:1px solid #e5e7eb;${upsellConfig.position === 'top' ? 'border-top:1px solid #e5e7eb;margin-top:8px;' : ''
      }flex-shrink:0;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
    <p style="margin:0;${titleStyle}">${escapeHtml(upsellConfig.upsellTitle.text || 'Product Recommendations')}</p>
    ${showUpsellNav
        ? `<div style="display:flex;gap:6px;">
      <button id="upsell-nav-left" class="cc-nav-btn" onclick="ccScrollContainer('cc-upsell-list','left')" title="${navPrevTitle}" style="display:none;">${navPrevSymbol}</button>
      <button id="upsell-nav-right" class="cc-nav-btn" onclick="ccScrollContainer('cc-upsell-list','right')" title="${navNextTitle}" style="display:none;">${navNextSymbol}</button>
    </div>`
        : ''
      }
  </div>
  <div class="cc-hide-scrollbar" style="${listStyle}" id="cc-upsell-list">
`;

    upsellProducts.forEach((productId) => {
      // Looser ID match: numeric tail or GID-contains check
      let detail =
        (matchedUpsellDetails || []).find(
          (d) => String(d.id).replace('gid://shopify/Product/', '') === productId ||
                 String(d.id).includes(productId)
        ) || null;

      // Always try to enrich from the live store catalog (/products.json).
      // This fixes: saved details with only {id}, image:"📦" placeholder, or
      // data saved when loadedShopifyProducts was empty in admin.
      if (storeDetailsById) {
        const storeDetail = storeDetailsById[String(productId)];
        if (storeDetail) {
          const savedImage = detail?.image;
          const useSavedImage = savedImage && savedImage !== '📦' && savedImage !== null;
          detail = {
            ...storeDetail,
            ...(detail || {}),
            // Always take live image when saved value is missing or placeholder
            image: useSavedImage ? savedImage : storeDetail.image,
            // Always take live title/price when saved value is missing
            title: (detail?.title && detail.title !== 'Product') ? detail.title : storeDetail.title,
            price: detail?.price || storeDetail.price,
            compareAtPrice: detail?.compareAtPrice || storeDetail.compareAtPrice,
            variantId: detail?.variantId || storeDetail.variantId,
          };
        }
      }

      detail = detail || {};

      // Skip products that cannot be resolved from the current store catalog
      // and have no valid saved title/price — prevents showing placeholder cards
      const resolvedFromStore = storeDetailsById && !!storeDetailsById[String(productId)];
      const hasSavedTitle = detail.title && detail.title.trim() !== '' && detail.title !== 'Product';
      if (!resolvedFromStore && !hasSavedTitle) return;

      const title = detail.title || 'Product';
      const priceText = detail.price ? CURRENCY_SYMBOL + parseFloat(detail.price).toFixed(0) : '';
      const compareAtText =
        detail.compareAtPrice && parseFloat(detail.compareAtPrice) > parseFloat(detail.price || 0)
          ? CURRENCY_SYMBOL + parseFloat(detail.compareAtPrice).toFixed(0)
          : '';
      const imageHtml =
        detail.image && detail.image !== '📦' && detail.image !== null
          ? `<img src="${detail.image}" alt="${escapeHtml(title)}" style="width:100%;height:100%;object-fit:contain;" loading="lazy">`
          : `<span style="font-size:20px;color:#94a3b8;" aria-hidden="true">📦</span>`;

      const hasVariantId = detail.variantId !== undefined && detail.variantId !== null && String(detail.variantId).trim() !== '';
      const addToCartId = hasVariantId ? detail.variantId : productId;
      const safeAddToCartId = ccExtractNumericId(addToCartId) || addToCartId;
      const addIsProductId = hasVariantId ? 'false' : 'true';
      const safeHandle = (detail.handle || '').replace(/[^a-z0-9-]/g, '');

      if (isGrid) {
        // GRID CARD: Always Square Design (Image on Top, Content Below)
        const gridCardStyle = '';
        html += `
          <div class="cc-upsell-card cc-layout-grid" style="${gridCardStyle}">
            <div class="cc-upsell-image-wrapper">
              ${imageHtml}
            </div>
            <div class="cc-upsell-content">
              <p class="cc-upsell-title cc-upsell-title--grid" style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#1e293b;
                line-height:1.2;width:100%;text-align:left;">${escapeHtml(title)}</p>
              <div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;margin-top:auto;">
                <span style="font-size:12px;font-weight:800;color:#10b981;">${priceText}</span>
                <button type="button" class="cc-add-btn" data-cc-id="${safeAddToCartId}" data-cc-handle="${safeHandle}" data-cc-isproduct="${addIsProductId}" style="padding:4px 10px;font-size:10px;background:${addBtnBg};color:${addBtnFg};">${escapeHtml(upsellConfig.buttonText || 'Add')}</button>
              </div>
            </div>
          </div>
        `;
      } else if (isVertical) {
        // PREMIUM VERTICAL CARD: fixed-size portrait product card (image,
        // centered title/price, spacer, pill button pinned to the bottom)
        // in a horizontally-scrolling, snap-aligned carousel row.
        html += `
          <div class="cc-upsell-card cc-upsell-card--v">
            <div class="cc-upsell-v-image">
              ${imageHtml}
            </div>
            <p class="cc-upsell-v-title">${escapeHtml(title)}</p>
            <div class="cc-upsell-v-price">
              <span class="cc-upsell-v-price-now">${priceText}</span>
              ${compareAtText ? `<span class="cc-upsell-v-price-compare">${compareAtText}</span>` : ''}
            </div>
            <div class="cc-upsell-v-spacer"></div>
            <button type="button" class="cc-add-btn cc-add-btn--v" data-cc-id="${safeAddToCartId}" data-cc-handle="${safeHandle}" data-cc-isproduct="${addIsProductId}" style="background:${addBtnBg};color:${addBtnFg};">${escapeHtml(upsellConfig.buttonText || 'Add to cart')}</button>
          </div>
        `;
      } else {
        // COMPACT HORIZONTAL-DIRECTION CARD: narrow card (image top, content
        // below) in a horizontal scroll — matches the editor preview so more
        // products are visible at once.
        html += `
          <div class="cc-upsell-card" style="min-width:150px;max-width:150px;flex-shrink:0;scroll-snap-align:start;display:flex;flex-direction:column;border:1px solid #e1e3e5;border-radius:8px;overflow:hidden;background:#fff;">
            <div style="width:90px;height:90px;margin:12px auto 0;background:#f1f2f3;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
              ${imageHtml}
            </div>
            <div style="padding:8px;display:flex;flex-direction:column;gap:4px;flex:1;">
              <p style="margin:0;font-size:11px;font-weight:600;color:#1e293b;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</p>
              <span style="font-size:12px;font-weight:800;color:#10b981;">${priceText}</span>
              <button type="button" class="cc-add-btn" data-cc-id="${safeAddToCartId}" data-cc-handle="${safeHandle}" data-cc-isproduct="${addIsProductId}" style="margin-top:auto;width:100%;padding:5px;font-size:10px;background:${addBtnBg};color:${addBtnFg};">${escapeHtml(upsellConfig.buttonText || 'Add')}</button>
            </div>
          </div>
        `;
      }
    });

    html += `</div></div>`;

    if (isCarousel) {
      setTimeout(() => {
        const list = document.getElementById('cc-upsell-list');
        if (!list) return;

        // Keyboard navigation — the list itself is the focusable, scrollable region.
        list.setAttribute('tabindex', '0');
        list.setAttribute('role', 'region');
        list.setAttribute('aria-label', (upsellConfig.upsellTitle.text || 'Recommended products') + ', scroll for more');
        list.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); ccScrollContainer('cc-upsell-list', 'right'); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); ccScrollContainer('cc-upsell-list', 'left'); }
        });

        // Mouse drag-to-scroll (touch swipe already works natively via overflow-x).
        // Capture the pointer only once real drag movement is detected, not
        // on every pointerdown — calling setPointerCapture immediately (the
        // previous behavior) retargets the eventual click event to `list`
        // instead of whatever was actually pressed, which silently ate every
        // "Add" button click made with a mouse (desktop) while leaving touch
        // untouched (it bails out above), matching "works on mobile, not
        // desktop". A small movement threshold before engaging drag mode is
        // the standard fix used by carousel/slider libraries for exactly
        // this click-vs-drag conflict.
        const DRAG_THRESHOLD_PX = 5;
        let isDown = false;
        let hasDragged = false;
        let startX = 0;
        let startScroll = 0;
        let dragPointerId = null;
        list.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'touch') return;
          isDown = true;
          hasDragged = false;
          startX = e.clientX;
          startScroll = list.scrollLeft;
          dragPointerId = e.pointerId;
        });
        list.addEventListener('pointermove', (e) => {
          if (!isDown) return;
          const delta = e.clientX - startX;
          if (!hasDragged) {
            if (Math.abs(delta) < DRAG_THRESHOLD_PX) return;
            hasDragged = true;
            list.setPointerCapture(dragPointerId);
            list.classList.add('cc-dragging');
          }
          list.scrollLeft = startScroll - delta;
        });
        const endDrag = () => {
          isDown = false;
          if (hasDragged && dragPointerId != null) {
            // Intentionally ignored: the pointer may already be released
            // (e.g. pointercancel fired first), which throws harmlessly.
            try { list.releasePointerCapture(dragPointerId); } catch (e) { /* noop */ }
          }
          hasDragged = false;
          list.classList.remove('cc-dragging');
        };
        list.addEventListener('pointerup', endDrag);
        list.addEventListener('pointercancel', endDrag);

        if (showUpsellNav) {
          const leftBtn = document.getElementById('upsell-nav-left');
          const rightBtn = document.getElementById('upsell-nav-right');
          if (!leftBtn || !rightBtn) return;

          const updateArrows = () => {
            const maxLeft = list.scrollWidth - list.clientWidth;
            if (maxLeft <= 5) {
              leftBtn.style.display = 'none';
              rightBtn.style.display = 'none';
              return;
            }
            leftBtn.style.display = list.scrollLeft > 5 ? 'flex' : 'none';
            rightBtn.style.display = list.scrollLeft < maxLeft - 5 ? 'flex' : 'none';
          };

          list.addEventListener('scroll', updateArrows);
          window.addEventListener('resize', updateArrows);
          updateArrows();
        }
      }, 100);
    }

    return html;
  }

  /* =================== UTILITY =================== */

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /* =================== GLOBAL FUNCTIONS (called from onclick) =================== */

  window.ccUpdateQty = function (key, qty) {
    updateQuantity(key, Math.max(0, qty));
  };

  window.ccRemoveItem = function (key) {
    removeItem(key);
  };

  // Delegated click listener for upsell "Add to Cart" buttons
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.cc-add-btn');
    if (!btn) return;

    var id = btn.getAttribute('data-cc-id') || '';
    var handle = btn.getAttribute('data-cc-handle') || '';
    var isProductId = btn.getAttribute('data-cc-isproduct') === 'true';
    var origText = btn.textContent;
    var origBg = btn.style.background;

    btn.disabled = true;
    btn.textContent = 'Adding...';

    function onDone(success) {
      if (success) {
        btn.textContent = 'Added!';
        btn.style.background = '#10b981';
        setTimeout(function () {
          btn.textContent = origText;
          btn.style.background = origBg;
          btn.disabled = false;
        }, 1500);
      } else {
        btn.textContent = origText;
        btn.style.background = origBg;
        btn.disabled = false;
      }
    }

    function addViaVariantId(variantId) {
      var numId = Number(variantId);
      console.log('[CartDrawer] add to cart — raw id:', variantId, '→ numId:', numId, '| isProductId:', isProductId, '| handle:', handle);
      if (!numId || isNaN(numId)) {
        console.error('[CartDrawer] invalid id, aborting');
        onDone(false);
        return;
      }
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: numId, quantity: 1 }] }),
      }).then(function (r) {
        if (r.ok) {
          setTimeout(function () { renderDrawer(); }, 300);
          setTimeout(function () { renderDrawer(); }, 800);
          onDone(true);
        } else {
          r.text().then(function (t) { console.error('[CartDrawer] 422 body:', t); });
          onDone(false);
        }
      }).catch(function (err) {
        console.error('[CartDrawer] fetch error:', err);
        onDone(false);
      });
    }

    // If data-cc-id is already a variant ID (not a product ID), use it directly —
    // avoids fetching the wrong variant (e.g. variants[0] may be out of stock)
    if (!isProductId && id) {
      addViaVariantId(id);
    } else if (handle) {
      // Only look up the product when we have a product ID and a handle
      fetch('/products/' + handle + '.js')
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(function (p) {
          var variants = p && p.variants;
          // Find first available variant, fallback to first variant
          var v = (variants || []).find(function (v) { return v.available; }) || (variants && variants[0]);
          var varId = v && v.id;
          if (varId) { addViaVariantId(varId); } else { onDone(false); }
        })
        .catch(function () { onDone(false); });
    } else {
      addViaVariantId(id);
    }
  });

  window.ccSendClickEvent = function (eventType) {
    sendClickEvent(eventType);
  };

  window.ccApplyCoupon = function (code) {
    applyCoupon(code);
  };

  window.ccScrollContainer = function (containerId, direction) {
    ccScrollContainer(containerId, direction);
  };

  window.ccCouponNav = function (direction) {
    ccCouponNav(direction);
  };

  window.testCart = openDrawer;

  /* =================== EAGER CONFIG LOAD =================== */
  // Load config immediately on page load so CONFIG is ready the moment
  // the user clicks Add to Cart. Without this, the first click always
  // finds CONFIG = null and the drawer never opens.
  loadConfig();

  /* =================== SUPPRESS THEME CART =================== */

  // 1. Override Shopify.onItemAdded — most themes call this after a successful
  //    cart add. We still call the original so header cart count stays accurate,
  //    but we redirect any drawer/notification open to ours.
  window.Shopify = window.Shopify || {};
  const _ccOrigOnItemAdded = window.Shopify.onItemAdded;
  window.Shopify.onItemAdded = function (lineItem) {
    if (typeof _ccOrigOnItemAdded === 'function') _ccOrigOnItemAdded.call(this, lineItem);
    scheduleOpenDrawer(300);
  };

  // 2. Patch cart-notification and cart-drawer custom elements (Dawn + others).
  //    We replace open/show so they open our drawer instead of theirs — but
  //    only when our drawer is actually configured/active (otherwise we'd
  //    permanently disable the native drawer with nothing to replace it),
  //    and we fall back to calling the ORIGINAL native method if our own
  //    drawer doesn't actually render in time, so a Cart Ninja failure can
  //    never leave the customer with no working cart drawer at all.
  ['cart-notification', 'cart-drawer', 'mini-cart', 'drawer-component', 'sidebar-cart', 'ajax-cart'].forEach(function (tag) {
    customElements.whenDefined(tag).then(function () {
      const Proto = customElements.get(tag) && customElements.get(tag).prototype;
      if (!Proto) return;
      ['open', 'show', 'reveal'].forEach(function (method) {
        if (typeof Proto[method] !== 'function') return;
        const originalMethod = Proto[method];
        Proto[method] = function () {
          if (!_ccActive) {
            ccDebug('customElement patch: drawer not active, passthrough to native', tag, method);
            return originalMethod.apply(this, arguments);
          }
          ccDebug('customElement patch: intercepted native open, trying ours first', tag, method);
          const nativeArgs = arguments;
          const nativeThis = this;
          scheduleOpenDrawer(300);
          setTimeout(function () {
            try {
              const ourOverlay = document.getElementById('cc-overlay');
              const ourDrawerOpen = ourOverlay && ourOverlay.classList.contains('active');
              if (!ourDrawerOpen) {
                ccDebug('customElement patch: our drawer did not open in time, falling back to native', tag, method);
                originalMethod.apply(nativeThis, nativeArgs);
              }
            } catch (err) {
              ccDebug('customElement patch: fallback check failed, calling native as last resort', err);
              try { originalMethod.apply(nativeThis, nativeArgs); } catch (e2) { ccDebug('customElement patch: native fallback also failed', e2); }
            }
          }, 1200);
        };
      });
    });
  });

  // 3. Patch native <dialog>.showModal()/.show() — the earliest reliable
  // interception point for dialog-based drawers (see NativeCartSuppressor
  // notes above ccNeutralizeNativeDrawer): patching BEFORE the dialog ever
  // opens means its ::backdrop and inert-page side effects never happen at
  // all, instead of having to react and close() it afterward. Gated by
  // ccLooksLikeNativeDrawer on the dialog itself so this can never touch an
  // unrelated dialog on the page (size guide, age gate, newsletter popup,
  // etc.) — only ones whose own tag/id/class positively match a known
  // native-cart-drawer pattern. The reactive MutationObserver + close()
  // path (ccNeutralizeNativeDrawer) stays in place as a fallback for the
  // rare case a dialog opens before this patch has had a chance to apply
  // (e.g. an extremely fast first interaction before our deferred script
  // finishes running) or for themes that don't call showModal()/show()
  // through the prototype method Cart Ninja can see.
  if (typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype) {
    ['showModal', 'show'].forEach(function (method) {
      const originalDialogMethod = HTMLDialogElement.prototype[method];
      if (typeof originalDialogMethod !== 'function') return;
      HTMLDialogElement.prototype[method] = function () {
        if (!_ccActive || !ccLooksLikeNativeDrawer(this)) {
          return originalDialogMethod.apply(this, arguments);
        }
        ccMilestone('Native drawer open attempt detected (dialog.' + method + ')', this);
        const nativeThis = this;
        const nativeArgs = arguments;
        scheduleOpenDrawer(300);
        setTimeout(function () {
          try {
            const ourOverlay = document.getElementById('cc-overlay');
            const ourDrawerOpen = ourOverlay && ourOverlay.classList.contains('active');
            if (!ourDrawerOpen) {
              ccDebug('dialog patch: our drawer did not open in time, falling back to native ' + method, nativeThis);
              originalDialogMethod.apply(nativeThis, nativeArgs);
            } else {
              ccMilestone('Native drawer suppressed (dialog.' + method + ' intercepted before it ever opened)', nativeThis);
              ccMilestone('Native overlay suppressed (dialog ::backdrop never created)', nativeThis);
            }
          } catch (err) {
            ccDebug('dialog patch: fallback check failed, calling native as last resort', err);
            try { originalDialogMethod.apply(nativeThis, nativeArgs); } catch (e2) { ccDebug('dialog patch: native fallback also failed', e2); }
          }
        }, 1200);
      };
    });
  }

  // ---- DIAGNOSTIC INSTRUMENTATION (debug-flag gated, log-only) ----
  // Purely observational — never blocks, changes, or delays anything.
  // Everything above this point (the customElement patch, the <dialog>
  // patch, the body MutationObserver + ccNeutralizeNativeDrawer) is what
  // actually intercepts/suppresses the native drawer. This section exists
  // only so that when CC_DEBUG is on, we can see the ACTUAL calling code
  // path (via a captured stack trace) for whatever ends up flipping a
  // drawer-related attribute or class — the single most direct way to
  // confirm which mechanism opened a still-visible native drawer, instead
  // of continuing to guess at theme internals blind.
  if (CC_DEBUG) {
    const ccIsDrawerRelevant = function (el, name, value) {
      if (!el || el.nodeType !== 1) return false;
      if (typeof el.closest === 'function' && el.closest('[data-cart-ninja-drawer]')) return false; // never log our own drawer
      if (ccLooksLikeNativeDrawer(el)) return true;
      if (name === 'open' && el.tagName && el.tagName.toLowerCase() === 'dialog') return true;
      if (name === 'aria-expanded' || name === 'aria-hidden') return true;
      if (typeof value === 'string' && (CC_OPEN_CLASSES.indexOf(value) !== -1 || CC_DRAWER_STATE_CLASSES.indexOf(value) !== -1)) return true;
      return false;
    };
    const ccElementLabel = function (el) {
      return el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    };
    const ccCaptureStack = function () {
      try { return new Error().stack; } catch (e) { return '(stack unavailable)'; }
    };

    const _ccOrigSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (ccIsDrawerRelevant(this, name, value)) {
        ccDebug('[CART-NINJA DEBUG] Native drawer mutation via setAttribute', {
          element: ccElementLabel(this), attribute: name, value: value,
          parent: this.parentElement ? ccElementLabel(this.parentElement) : null,
          stack: ccCaptureStack(),
        });
        if (name === 'open') ccDebug('[CART-NINJA DEBUG] Native drawer open attribute changed', ccElementLabel(this));
        if (name === 'aria-expanded' || name === 'aria-hidden') ccDebug('[CART-NINJA DEBUG] Native drawer aria state changed', ccElementLabel(this), name, value);
      }
      return _ccOrigSetAttribute.call(this, name, value);
    };

    const _ccOrigClassListAdd = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function () {
      const el = (this && 'ownerElement' in this) ? this.ownerElement : null;
      const args = Array.prototype.slice.call(arguments);
      if (el && ccIsDrawerRelevant(el, 'class', args.join(' '))) {
        ccDebug('[CART-NINJA DEBUG] Native drawer class changed (classList.add)', {
          element: ccElementLabel(el), addedClasses: args,
          parent: el.parentElement ? ccElementLabel(el.parentElement) : null,
          stack: ccCaptureStack(),
        });
      }
      return _ccOrigClassListAdd.apply(this, arguments);
    };

    const _ccOrigClassListToggle = DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle = function (token) {
      const el = (this && 'ownerElement' in this) ? this.ownerElement : null;
      if (el && ccIsDrawerRelevant(el, 'class', token)) {
        ccDebug('[CART-NINJA DEBUG] Native drawer class changed (classList.toggle)', {
          element: ccElementLabel(el), toggledClass: token,
          parent: el.parentElement ? ccElementLabel(el.parentElement) : null,
          stack: ccCaptureStack(),
        });
      }
      return _ccOrigClassListToggle.apply(this, arguments);
    };

    // Extra fallback observer purely for logging every attribute mutation
    // on any drawer-relevant element, independent of whether it went
    // through setAttribute/classList (some frameworks mutate via the IDL
    // property, e.g. el.className = '...' or el.open = true, which
    // bypasses both patches above but still shows up here).
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (!ccIsDrawerRelevant(m.target, m.attributeName, m.target.getAttribute ? m.target.getAttribute(m.attributeName) : null)) return;
        ccDebug('[CART-NINJA DEBUG] Native drawer mutation (observed)', {
          element: ccElementLabel(m.target), attribute: m.attributeName,
          newValue: m.target.getAttribute ? m.target.getAttribute(m.attributeName) : null,
        });
      });
    }).observe(document.documentElement, { subtree: true, attributes: true });
  }
})();
