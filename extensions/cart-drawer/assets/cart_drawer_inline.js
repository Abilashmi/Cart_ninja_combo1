(function () {
  console.log('[CartDrawer] Script loaded ✓');

  const container = document.getElementById('cc-root');
  const SHOP = container.getAttribute('data-shop');
  const CURRENCY_CODE = container.getAttribute('data-currency') || 'USD';
  const API_BASE = '/apps/cart-app';
  const CONFIG_API = API_BASE + '/save_cart_drawer.php?shopdomain=' + SHOP;
  const COUPON_API = API_BASE + '/save_coupon.php?shopdomain=' + SHOP;
  const CLICK_API = API_BASE + '/click.php';

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

  let CONFIG = null;
  let COUPONS = [];
  let appliedCouponCodes = [];
  let _lastCopiedCode = null;
  let _ccConfigLoading = false;
  let _ccActive = false; // true only when drawer is fully configured and active


  const CC_STORE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
  let _ccStoreCatalogCache = { ts: 0, candidateCatalog: [], detailsById: {} };
  let _ccStoreCatalogPromise = null;

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
          announcement: {
            enabled: isEnabled(d.announcement_enabled),
            text: d.announcement_text || '',
            bgColor: d.announcement_bg_color || '#4f46e5',
            textColor: d.announcement_text_color || '#ffffff',
            fontSize: parseInt(d.announcement_font_size || 14, 10),
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
    // Use the explicitly saved mode field first (matches what admin saves via handleSaveAll)
    const mode = data.mode || (data.rewardsCalculation?.[0] === 'cartQuantity' ? 'quantity' : 'amount');

    const rawTiers = Array.isArray(data.tiers) ? data.tiers : [];
    const parsedTiers = rawTiers
      .map((t) => {
        // Robustly parse target: try multiple fields, coerce to number
        let target;
        if (mode === 'quantity') {
          target = parseFloat(t.minQuantity) || parseFloat(t.target) || 1;
        } else {
          target = parseFloat(t.minValue) || parseFloat(t.target) || parseFloat(t.minQuantity) || 0;
        }
        return {
          id: t.id,
          target: target,
          title: t.title || '',
          rewardText: t.description || 'Reward',
          products: t.products || [],
          rewardType: t.rewardType || 'product',
          iconType: t.iconType || 'preset',
          iconPreset: t.iconPreset || 'gift',
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
      placement: data.placement || 'top',
    };
  }

  function parseCheckoutButtonStyle(d) {
    const raw = d.checkout_button_style;
    if (!raw) return { backgroundColor: '#111827', textColor: '#ffffff', borderRadius: 12 };
    const data = typeof raw === 'string' ? parseJSON(raw) : raw;
    return {
      backgroundColor: data.backgroundColor || '#111827',
      textColor: data.textColor || '#ffffff',
      borderRadius: data.borderRadius !== undefined ? parseInt(data.borderRadius, 10) : 12,
    };
  }

  function parseCouponData(d) {
    const data = parseJSON(d.coupon_data || d.couponData);
    const enabled = isEnabled(d.coupon_status) || isEnabled(d.couponStatus) || isEnabled(data.enabled);

    const title = data && typeof data.title === 'object' && data.title ? data.title : {};
    const rawAlign = title.alignment || data.titleAlignment || 'left';
    const safeAlign = rawAlign === 'center' || rawAlign === 'right' || rawAlign === 'left' ? rawAlign : 'left';

    return {
      enabled,
      style: data.style || data.selectedStyle || 'style-2',
      position: data.position || 'top',
      layout: data.layout || 'grid',
      alignment: data.alignment || 'horizontal',
      title: {
        text: title.text || data.titleText || 'Apply Coupon',
        fontSize: parseInt(title.fontSize ?? data.titleFontSize ?? 14, 10) || 14,
        textColor: title.textColor || data.titleTextColor || '#1e293b',
        alignment: safeAlign,
      },
      selectedActiveCoupons: data.selectedActiveCoupons || [],
      couponOverrides: data.couponOverrides || {},
      allCouponDetails: data.allCouponDetails || [],
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
    // Check if any upsell product is missing details (only has id)
    const needsEnrichment = (upsell.manualRules || []).some((rule) =>
      (rule.upsellProductDetails || []).some((d) => !d.title || !d.price || !d.variantId)
    );
    if (!needsEnrichment) return;

    try {
      const res = await originalFetch('/products.json?limit=250');
      const data = await res.json();
      // Build lookup map: numeric product ID → product object
      const productMap = {};
      for (const p of data.products || []) {
        productMap[String(p.id)] = p;
      }

      for (const rule of upsell.manualRules || []) {
        rule.upsellProductDetails = (rule.upsellProductDetails || []).map((detail) => {
          const numId = ccExtractNumericId(detail.id) || String(detail.id || '').replace('gid://shopify/Product/', '');
          const sp = productMap[numId];
          if (sp) {
            return {
              ...detail,
              title: detail.title || sp.title,
              price: detail.price || sp.variants?.[0]?.price || sp.price_min || '',
              image: detail.image || sp.images?.[0]?.src || sp.featured_image || null,
              handle: sp.handle,
              variantId: ccExtractNumericId(detail.variantId) || detail.variantId || sp.variants?.[0]?.id,
            };
          }
          return detail;
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
      this.addEventListener('load', function () {
        if (this.status >= 200 && this.status < 300) {
          scheduleOpenDrawer(350);
        }
      });
    }
    return originalXHROpen.apply(this, arguments);
  };

  // 3. Form submit intercept — prevents page navigation and converts to AJAX
  // This is critical for themes that do a real form POST to /cart/add.
  // Only intercepts when _ccActive is true — if the drawer is disabled or not
  // yet configured, we let the theme handle add-to-cart naturally so the user
  // always gets feedback even when the drawer config is missing/unavailable.
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || !form.action || !form.action.includes('/cart/add')) return;
    if (!_ccActive) return; // drawer not active — let theme handle it
    e.preventDefault();
    e.stopPropagation();
    const formData = new FormData(form);
    originalFetch('/cart/add.js', { method: 'POST', body: formData })
      .then(function (res) {
        if (res.ok) scheduleOpenDrawer(300);
      })
      .catch(function () { });
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
      e.preventDefault();
      e.stopImmediatePropagation();
      openDrawer();
    }
  }, true);

  // 6. Shopify section rendering events (used when themes reload sections via AJAX)
  document.addEventListener('shopify:section:load', function () {
    if (new URL(location.href).searchParams.get('added')) scheduleOpenDrawer(100);
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
  // cart drawer/panel by adding an 'open', 'active', or 'is-visible' class.
  // This is the universal fallback for themes not covered above.
  (function () {
    const CC_DRAWER_TAGS = [
      'cart-notification', 'cart-drawer',   // Dawn family
      'mini-cart',                           // Focal / Impact
      'drawer-component', 'sidebar-cart', 'ajax-cart', // other modern themes
    ];
    const CC_DRAWER_IDS = [
      'CartDrawer', 'cart-sidebar', 'MiniCart', 'mini-cart',
      'ajax-cart', 'CartContainer', 'slideout-cart', 'slide-cart', 'flyout-cart',
      'sidebar-cart',                        // Prestige / Warehouse
    ];
    const CC_OPEN_CLASSES = [
      'open', 'is-open', 'is-visible', 'active', 'is-active', 'show', 'cart--open',
      'drawer--is-open',                     // Debut / Brooklyn / Impulse
      'drawer--open',                        // Prestige / Focal / Impact
      'drawer--visible',                     // Pipeline / Broadcast
      'js-drawer-open',                      // Archetype themes (applied to body)
    ];

    new MutationObserver(function (mutations) {
      for (const m of mutations) {
        const el = m.target;
        if (!el || !el.tagName) continue;
        // Only watch elements that look like cart panels
        const isCartEl =
          CC_DRAWER_TAGS.includes(el.tagName.toLowerCase()) ||
          CC_DRAWER_IDS.includes(el.id) ||
          (el.className && typeof el.className === 'string' &&
            (el.className.includes('cart-drawer') || el.className.includes('mini-cart') ||
              el.className.includes('ajax-cart') || el.className.includes('cart-sidebar') ||
              el.className.includes('drawer--cart') || el.className.includes('drawer--right') ||
              el.className.includes('mini_cart') || el.className.includes('cart_container')));
        if (!isCartEl) continue;
        // Check if a visible/open class was just added
        if (m.type === 'attributes' && m.attributeName === 'class') {
          const added = CC_OPEN_CLASSES.some((c) => el.classList.contains(c));
          if (added) scheduleOpenDrawer(200);
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  })();

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
  window.addEventListener('load', ccWatchCartCount);

  /* =================== EVENT TRACKING =================== */

  async function sendClickEvent(eventType) {
    try {
      // Attempt to get shop_id. If not available in CONFIG, use null.
      const shopId = CONFIG?.id || null;
      const payload = {
        shop_id: shopId,
        domain: SHOP,
        event_type: eventType,
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
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(null, () => ccCopyTextFallback(code));
      } else {
        ccCopyTextFallback(code);
      }
    } catch (e) {
      ccCopyTextFallback(code);
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

  const CC_ICON_PRESETS = {
    gift: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"/></svg>',
    shipping:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 18.5a1.5 1.5 0 0 1-1.5-1.5 1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5m1.5-9 1.96 2.5H17V9.5m-11 9A1.5 1.5 0 0 1 4.5 17 1.5 1.5 0 0 1 6 15.5 1.5 1.5 0 0 1 7.5 17 1.5 1.5 0 0 1 6 18.5M20 8h-3V4H3c-1.11 0-2 .89-2 2v11h2a3 3 0 0 0 3 3 3 3 0 0 0 3-3h6a3 3 0 0 0 3 3 3 3 0 0 0 3-3h2v-5l-3-4Z"/></svg>',
    discount:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    trophy:
      '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.9 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 5h2v3H4V5zm7 10.93c-3.95-.49-7-3.85-7-7.93h14c0 4.08-3.05 7.44-7 7.93z"/><path d="M16 19H8v2h8z"/></svg>',
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
    style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px;">✕</button>
</div>
`;

    /* -------- ANNOUNCEMENT BAR (below header) -------- */
    const ann = CONFIG.announcement || {};
    if (ann.enabled && ann.text) {
      drawerHtml += `<div id="cc-announcement-bar" style="padding:8px 16px;background:${ann.bgColor || '#4f46e5'};color:${ann.textColor || '#ffffff'};font-size:${ann.fontSize || 14}px;text-align:center;font-weight:500;flex-shrink:0;">${escapeHtml(ann.text)}</div>`;
    }

    /* -------- BODY -------- */
    drawerHtml += `<div id="cc-drawer-body" style="flex:1;padding:16px 16px 40px 16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;">`;

    /* ---- PROGRESS BAR ---- */
    const progress = CONFIG.progress;
    if (progress.enabled && (progress.showOnEmpty || !isEmpty)) {
      const pInfo = getProgressInfo(cartTotal, cartQty, progress);

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

      // ---- PROGRESS TRACK with outline ----
      pbHtml += `<div style="position:relative;width:calc(100% - 20px);height:10px;margin:8px 10px 48px 10px;background:${progress.barBackgroundColor || '#e2e8f0'
        };border-radius:99px;border:1.5px solid ${fgColor}22;box-shadow:inset 0 1px 3px rgba(0,0,0,0.06);">`;

      // 1. The progress bar filler
      pbHtml += `<div style="position:absolute;left:0;top:0;height:100%;width:${pInfo.percentage}%;background:linear-gradient(90deg, ${fgColor}, ${fgColor}dd);border-radius:99px;transition:width 1s cubic-bezier(.4,0,.2,1);box-shadow:0 0 12px ${fgColor}44;z-index:1;display:block !important;overflow:hidden;font-size:0;line-height:0;">&nbsp;</div>`;

      // 2. Tier segment markers — thin lines on the track showing where each level is
      pInfo.tiers.forEach((ms) => {
        const segPercent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const reached = pInfo.currentVal >= ms.target;
        pbHtml += `<div style="position:absolute;left:${segPercent}%;top:-3px;width:2px;height:calc(100% + 6px);background:${reached ? fgColor : '#cbd5e180'
          };border-radius:1px;z-index:0;display:block !important;">&nbsp;</div>`;
      });

      // 3. The milestone nodes
      pInfo.tiers.forEach((ms, idx) => {
        const isCompleted = pInfo.currentVal >= ms.target;
        const prevTarget = idx > 0 ? pInfo.tiers[idx - 1].target : 0;
        const isNext = !isCompleted && pInfo.currentVal >= prevTarget;
        const percent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const iconFill = progress.iconColor || progress.icon_color || fgColor;
        const iconHtml = getMilestoneIconHtml(ms, iconFill);
        const nodeSize = isCompleted || isNext ? 40 : 32;
        const iconSize = isCompleted || isNext ? 20 : 16;

        pbHtml += `<div style="position:absolute;left:${percent}%;top:50%;transform:translate(-50%,-50%);z-index:3;display:flex;flex-direction:column;align-items:center;">`;

        // Node circle — No background or border as requested, just the icon
        pbHtml += `<div style="width:${nodeSize}px;height:${nodeSize}px;display:flex;align-items:center;justify-content:center;transition:all .3s ease;${isNext ? 'animation:cc-pulse-ring 2s infinite;--cc-fg-color66:' + fgColor + '66;' : ''}position:relative;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));color:${iconFill};">`;
        pbHtml += `<span style="width:${iconSize}px;height:${iconSize}px;display:flex;align-items:center;justify-content:center;font-size:${isCompleted || isNext ? '28px' : '22px'};pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.1));">${iconHtml}</span>`;
        pbHtml += `</div>`;

        // Description label below node
        const amountDisplay = pInfo.mode === 'amount' ? CURRENCY_SYMBOL + Math.round(ms.target) : ms.target + ' items';

        pbHtml += `<div style="position:absolute;top:100%;margin-top:8px;width:120px;left:50%;transform:translateX(-50%);text-align:center;font-size:11px;line-height:1.2;pointer-events:none;z-index:10;display:flex;flex-direction:column;align-items:center;transition:all .3s ease;color:${isCompleted ? fgColor : '#64748b'};opacity:${isCompleted || isNext ? 1 : 0.7};word-wrap:break-word;">`;

        pbHtml += `<span style="font-weight:800;font-size:12px;margin-bottom:2px;">${amountDisplay}</span>`;

        // Match the editor preview: show a single label (title takes precedence, else reward text)
        const msLabel = ms.title || ms.rewardText;
        if (msLabel) {
          pbHtml += `<span style="font-weight:600;opacity:0.9;">${escapeHtml(msLabel)}</span>`;
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
    ${ec.showContinueShopping !== false ? `<button onclick="document.querySelector('#cc-overlay').classList.remove('active');setTimeout(()=>{document.getElementById('cc-root').innerHTML=''},350);" style="margin-top:4px;padding:8px 18px;border:1px solid #c9cccf;border-radius:7px;background:#fff;font-size:13px;cursor:pointer;color:#202223;">Continue shopping</button>` : ''}
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
  <a href="/checkout" style="text-decoration:none;" onclick="ccSendClickEvent('checkout_click')">
    <button style="width:100%;padding:16px;background:${(CONFIG.checkoutButtonStyle && CONFIG.checkoutButtonStyle.backgroundColor) || '#111827'};color:${(CONFIG.checkoutButtonStyle && CONFIG.checkoutButtonStyle.textColor) || '#fff'};border:none;border-radius:${(CONFIG.checkoutButtonStyle && CONFIG.checkoutButtonStyle.borderRadius !== undefined) ? CONFIG.checkoutButtonStyle.borderRadius : 12}px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);transition:all .2s ease;">
      ${escapeHtml(CONFIG.checkoutName || 'Checkout Now')} <span style="font-size:18px;">→</span>
    </button>
  </a>
  <p style="margin:12px 0 0 0;text-align:center;font-size:11px;color:#94a3b8;font-weight:500;">
    ${escapeHtml(CONFIG.checkoutFooterText || 'Shipping and taxes calculated at checkout')}
  </p>
</div>
`;

    // ---- SMOOTH DOM UPDATE ----
    if (isFirstOpen) {
      // First open: build full overlay with backdrop + drawer
      const drawerAnim = (CONFIG.design && CONFIG.design.animation) || 'slide';
      overlay.innerHTML = `<div id="cc-backdrop"></div><div id="cc-drawer" data-animation="${drawerAnim}">${drawerHtml}</div>`;
      root.appendChild(overlay);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.classList.add('active');
        });
      });
      document.getElementById('cc-backdrop').addEventListener('click', closeDrawer);
    } else {
      // Subsequent updates: only replace drawer inner content (no flash)
      const drawer = document.getElementById('cc-drawer');
      if (drawer) {
        drawer.innerHTML = drawerHtml;
      }
      overlay.classList.add('active');

      // Restore scroll position
      const newBody = document.getElementById('cc-drawer-body');
      if (newBody && savedScroll > 0) {
        newBody.scrollTop = savedScroll;
      }

      // Re-attach backdrop listener
      const backdrop = document.getElementById('cc-backdrop');
      if (backdrop) backdrop.addEventListener('click', closeDrawer);
    }
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
            backgroundColor: saved.backgroundColor || '#000',
            textColor: saved.textColor || '#fff',
            iconUrl: saved.iconUrl || '🎟️',
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
            iconUrl: override.iconUrl || apiCoupon.iconUrl || '🎟️',
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

    /* -- Coupon list is always a horizontal carousel so nav arrows work -- */
    const couponListStyle =
      'display:flex;flex-direction:row;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-ms-overflow-style:none;scrollbar-width:none;padding:0 4px 20px 4px;';

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
        const baseColor = coupon.backgroundColor || '#1a1a2e';
        const icon = coupon.iconUrl || '☀️';
        const btnBg = coupon.buttonBackgroundColor || baseColor;
        const btnTc = coupon.buttonTextColor || '#ffffff';
        const btnLabel = coupon.code === _lastCopiedCode ? 'Copied' : (coupon.buttonText || 'Apply');
        html += `
    <div data-coupon-card class="cc-coupon-card" style="min-width:220px;width:100%;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);display:flex;align-items:center;gap:10px;position:relative;">
      <div style="position:absolute;top:0;left:0;width:4px;height:100%;background:${baseColor};border-radius:12px 0 0 12px;"></div>
      <div style="width:40px;height:40px;border-radius:8px;background:${baseColor}20;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <p style="margin:0;font-size:13px;font-weight:700;color:#1e293b;line-height:1.3;">${escapeHtml(coupon.code)}</p>
        <p style="margin:2px 0 0 0;font-size:11px;color:#64748b;line-height:1.3;">${escapeHtml(coupon.label || coupon.description)}</p>
      </div>
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="padding:6px 12px;background:${coupon.code === _lastCopiedCode ? '#10b981' : btnBg};color:${btnTc};border:none;border-radius:6px;font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer;flex-shrink:0;">
        ${escapeHtml(btnLabel)}
      </button>
    </div>
  `;
      } else if (style === 'style-2') {
        const btnBg = coupon.buttonBackgroundColor || '#1e293b';
        const btnTc = coupon.buttonTextColor || '#ffffff';
        const btnLabel = coupon.buttonText || 'Apply';
        html += `
    <div data-coupon-card class="cc-coupon-card" style="padding:14px;background:#fff;border:${coupon.code === _lastCopiedCode ? '2px solid ' + coupon.backgroundColor : '1px solid #e2e8f0'
          };border-radius:${coupon.borderRadius || 8}px;box-shadow:0 4px 12px rgba(0,0,0,0.06);display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;position:relative;min-width:160px;">
      <div style="width:48px;height:48px;border-radius:14px;background:${coupon.backgroundColor
          };display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 4px 10px ${coupon.backgroundColor}40;">${coupon.iconUrl}</div>
      <div style="width:100%;">
        <p style="margin:0 0 2px 0;font-size:14px;font-weight:800;color:#1e293b;text-align:center;line-height:1.3;">${escapeHtml(coupon.code)}</p>
        <p style="margin:0;font-size:11px;color:#64748b;text-align:center;line-height:1.3;">${escapeHtml(coupon.description)}</p>
      </div>
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="width:100%;padding:8px;margin-top:2px;background:${coupon.code === _lastCopiedCode ? '#10b981' : btnBg
          };color:${coupon.code === _lastCopiedCode ? '#fff' : btnTc};border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;position:relative;">
        ${coupon.code === _lastCopiedCode ? '✓ Copied!' : escapeHtml(btnLabel)}
        ${coupon.code === _lastCopiedCode ? `<div style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:10px;color:#10b981;font-weight:700;white-space:nowrap;animation:cc-fade-in 0.3s ease;">Copied to clipboard</div>` : ''}
      </button>
    </div>
  `;
      } else {
        // Style 3: Colored header + white body with dashed code box
        const btnTc = coupon.buttonTextColor || '#2563eb';
        const btnLabel = coupon.buttonText || 'COPY';
        const discountBadge = coupon.discountValue > 0 ? `${coupon.discountValue}% OFF` : (coupon.label || '');
        html += `
    <div data-coupon-card class="cc-coupon-card" style="padding:0;background:#fff;border:1px solid #e2e8f0;border-radius:${coupon.borderRadius || 8}px;box-shadow:0 2px 6px rgba(0,0,0,0.04);display:flex;flex-direction:column;overflow:hidden;min-width:200px;">
      <div style="background:${coupon.backgroundColor};padding:10px 14px;display:flex;align-items:center;justify-content:space-between;color:${coupon.textColor};">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
          <span style="font-size:16px;flex-shrink:0;">${coupon.iconUrl}</span>
          <span style="font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(coupon.label || coupon.code)}</span>
        </div>
        ${discountBadge ? `<div style="background:rgba(255,255,255,0.2);padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;white-space:nowrap;margin-left:8px;">${escapeHtml(discountBadge)}</div>` : ''}
      </div>
      ${coupon.description ? `<div style="padding:6px 14px 2px 14px;"><p style="margin:0;font-size:11px;color:#64748b;line-height:1.3;">${escapeHtml(coupon.description)}</p></div>` : ''}
      <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="flex:1;border:1px dashed #cbd5e1;border-radius:6px;padding:6px 10px;background:#f8fafc;display:flex;align-items:center;">
          <p style="margin:0;font-size:12px;font-weight:700;color:#334155;font-family:monospace;line-height:1;">${escapeHtml(coupon.code)}</p>
        </div>
        <div style="position:relative;flex-shrink:0;">
          <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="border:none;background:none;color:${coupon.code === _lastCopiedCode ? '#10b981' : btnTc};font-size:12px;font-weight:700;cursor:pointer;padding:4px;white-space:nowrap;">${coupon.code === _lastCopiedCode ? 'COPIED' : escapeHtml(btnLabel)}</button>
          ${coupon.code === _lastCopiedCode ? `<div style="position:absolute;bottom:-14px;right:0;font-size:8px;color:#10b981;font-weight:700;white-space:nowrap;animation:cc-fade-in 0.3s ease;">Copied!</div>` : ''}
        </div>
      </div>
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

    const navPrevSymbol = isHorizontal ? '←' : '↑';
    const navNextSymbol = isHorizontal ? '→' : '↓';
    const navPrevTitle = isHorizontal ? 'Scroll left' : 'Scroll up';
    const navNextTitle = isHorizontal ? 'Scroll right' : 'Scroll down';

    // --- Container Styles based on Layout AND Direction ---
    let listStyle = `display: ${isGrid ? 'grid' : 'flex'}; gap: 12px; scroll-behavior: smooth;`;

    if (isGrid) {
      // GRID: Uses CSS Grid for strict 1 or 2 column distribution
      listStyle += `grid-template-columns: ${isHorizontal ? 'repeat(2, 1fr)' : 'repeat(1, 1fr)'};`;
      if (isVertical) {
        listStyle += `justify-items: start;`;
      }
    } else {
      // CAROUSEL: Uses Flexbox for sliding flow
      listStyle += `flex-direction: ${isHorizontal ? 'row' : 'column'};`;
      listStyle += `overflow-x: ${isHorizontal ? 'auto' : 'hidden'};`;
      listStyle += `overflow-y: ${isVertical ? 'auto' : 'hidden'};`;
      if (isVertical) {
        listStyle += `max-height: 280px;`;
      }
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
      const imageHtml =
        detail.image && detail.image !== '📦' && detail.image !== null
          ? `<img src="${detail.image}" style="width:100%;height:100%;object-fit:contain;" loading="lazy">`
          : `<span style="font-size:20px;color:#94a3b8;">📦</span>`;

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
                <button type="button" class="cc-add-btn" data-cc-id="${safeAddToCartId}" data-cc-handle="${safeHandle}" data-cc-isproduct="${addIsProductId}" style="padding:4px 10px;font-size:10px;">${escapeHtml(upsellConfig.buttonText || 'Add')}</button>
              </div>
            </div>
          </div>
        `;
      } else {
        // CAROUSEL CARD: narrow vertical card (image top, content below) in a horizontal
        // scroll — matches the editor preview so multiple products are visible.
        const cardSpecialStyle = isHorizontal
          ? 'min-width:150px;max-width:150px;'
          : 'width:100%;';
        html += `
          <div class="cc-upsell-card" style="${cardSpecialStyle}flex-shrink:0;scroll-snap-align:start;display:flex;flex-direction:column;border:1px solid #e1e3e5;border-radius:8px;overflow:hidden;background:#fff;">
            <div style="width:100%;height:90px;background:#f1f2f3;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
              ${imageHtml}
            </div>
            <div style="padding:8px;display:flex;flex-direction:column;gap:4px;flex:1;">
              <p style="margin:0;font-size:11px;font-weight:600;color:#1e293b;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(title)}</p>
              <span style="font-size:12px;font-weight:800;color:#10b981;">${priceText}</span>
              <button type="button" class="cc-add-btn" data-cc-id="${safeAddToCartId}" data-cc-handle="${safeHandle}" data-cc-isproduct="${addIsProductId}" style="margin-top:auto;width:100%;padding:5px;font-size:10px;">${escapeHtml(upsellConfig.buttonText || 'Add')}</button>
            </div>
          </div>
        `;
      }
    });

    html += `</div></div>`;

    if (showUpsellNav) {
      setTimeout(() => {
        const list = document.getElementById('cc-upsell-list');
        const leftBtn = document.getElementById('upsell-nav-left');
        const rightBtn = document.getElementById('upsell-nav-right');
        if (!list || !leftBtn || !rightBtn) return;

        const updateArrows = () => {
          if (isHorizontal) {
            const maxLeft = list.scrollWidth - list.clientWidth;
            if (maxLeft <= 5) {
              leftBtn.style.display = 'none';
              rightBtn.style.display = 'none';
              return;
            }
            leftBtn.style.display = list.scrollLeft > 5 ? 'flex' : 'none';
            rightBtn.style.display = list.scrollLeft < maxLeft - 5 ? 'flex' : 'none';
            return;
          }

          const maxTop = list.scrollHeight - list.clientHeight;
          if (maxTop <= 5) {
            leftBtn.style.display = 'none';
            rightBtn.style.display = 'none';
            return;
          }
          leftBtn.style.display = list.scrollTop > 5 ? 'flex' : 'none';
          rightBtn.style.display = list.scrollTop < maxTop - 5 ? 'flex' : 'none';
        };

        list.addEventListener('scroll', updateArrows);
        window.addEventListener('resize', updateArrows);
        updateArrows();
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
  //    We replace open/show so they open our drawer instead of theirs.
  ['cart-notification', 'cart-drawer', 'mini-cart', 'drawer-component', 'sidebar-cart', 'ajax-cart'].forEach(function (tag) {
    customElements.whenDefined(tag).then(function () {
      const Proto = customElements.get(tag) && customElements.get(tag).prototype;
      if (!Proto) return;
      ['open', 'show', 'reveal'].forEach(function (method) {
        if (typeof Proto[method] === 'function') {
          Proto[method] = function () {
            scheduleOpenDrawer(300);
          };
        }
      });
    });
  });
})();
