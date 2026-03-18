(function () {
  console.log('[CartDrawer] Script loaded ✓');

  const SHOP = document.getElementById('cc-root').getAttribute('data-shop');
  const API_BASE = '/apps/cart-app';
  const CONFIG_API = API_BASE + '/save_cart_drawer.php?shopdomain=' + SHOP;
  const COUPON_API = API_BASE + '/save_coupon.php?shopdomain=' + SHOP;
  const CLICK_API = API_BASE + '/click.php';

  let CONFIG = null;
  let COUPONS = [];
  let appliedCouponCodes = [];
  let _ccConfigLoading = false;

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
          return;
        }

        CONFIG = {
          cartStatus: true,
          progress: parseProgressData(d),
          coupon: parseCouponData(d),
          upsell: parseUpsellData(d),
        };

        await enrichUpsellProducts(CONFIG.upsell);
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
          coupon: { enabled: false, selectedActiveCoupons: [], style: 'style-2', position: 'top', layout: 'grid', alignment: 'horizontal', couponOverrides: {}, allCouponDetails: [] },
          upsell: { enabled: false, manualRules: [], direction: 'vertical', layout: 'carousel', position: 'bottom', showOnEmptyCart: false, showIfInCart: false, limit: 3, buttonText: 'Add to cart', upsellTitle: { text: 'Recommended for you', color: '#111827', bold: false, italic: false, underline: false }, activeTemplate: 'grid' },
        };
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
      barBackgroundColor: data.barBackgroundColor || '#e2e8f0',
      barForegroundColor: data.barForegroundColor || data.fill_color || '#2563eb',
      borderRadius: data.borderRadius || 8,
      completionText: data.completionText || '🎉 All Rewards Unlocked!',
      maxTarget: maxTarget,
      tiers: parsedTiers,
    };
  }

  function parseCouponData(d) {
    const data = parseJSON(d.coupon_data || d.couponData);
    const enabled = isEnabled(d.coupon_status) || isEnabled(d.couponStatus) || isEnabled(data.enabled);
    return {
      enabled,
      style: data.style || data.selectedStyle || 'style-2',
      position: data.position || 'top',
      layout: data.layout || 'grid',
      alignment: data.alignment || 'horizontal',
      selectedActiveCoupons: data.selectedActiveCoupons || [],
      couponOverrides: data.couponOverrides || {},
      allCouponDetails: data.allCouponDetails || [],
    };
  }

  function parseUpsellData(d) {
    const data = parseJSON(d.upsell_data || d.upsellData);
    const enabled = isEnabled(d.upsell_status) || isEnabled(d.upsellStatus) || isEnabled(data.enabled);
    return {
      enabled,
      upsellMode: data.upsellMode || 'manual',
      useAI: data.useAI !== false,
      showIfInCart: data.showIfInCart || false,
      limit: data.limit || 3,
      showReviews: data.showReviews || false,
      position: data.position || 'bottom',
      direction:
        data.direction === 'block'
          ? 'vertical'
          : data.direction === 'row'
            ? 'horizontal'
            : data.direction || 'vertical',
      showOnEmptyCart: data.showOnEmptyCart !== false,
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
      layout: data.layout || 'carousel', // 'carousel' or 'grid'
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
          const numId = String(detail.id || '').replace('gid://shopify/Product/', '');
          const sp = productMap[numId];
          if (sp) {
            return {
              ...detail,
              title: detail.title || sp.title,
              price: detail.price || sp.variants?.[0]?.price || sp.price_min || '',
              image: detail.image || sp.images?.[0]?.src || sp.featured_image || null,
              handle: sp.handle,
              variantId: detail.variantId || sp.variants?.[0]?.id,
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
  // This is critical for themes that do a real form POST to /cart/add
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || !form.action || !form.action.includes('/cart/add')) return;
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
      // If variantId looks like a product ID (no variant), try to resolve it
      let resolvedId = variantId;
      if (!resolvedId || String(resolvedId).length < 10) {
      }
      const res = await originalFetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: resolvedId, quantity: quantity || 1 }] }),
      });
      if (res.ok) {
        // Double-render: first quick refresh, then a follow-up to catch
        // any Shopify session lag in updating cart state
        setTimeout(() => renderDrawer(), 300);
        setTimeout(() => renderDrawer(), 800);
      } else {
        const errData = await res.json().catch(() => ({}));
        // If it failed because it's a product ID and not a variant, try resolving
        if (errData.description && errData.description.includes('not found')) {
          await resolveAndAddVariant(variantId, quantity);
        }
      }
    } catch (e) {
    }
  }

  async function resolveAndAddVariant(productId, quantity) {
    try {
      const res = await originalFetch('/products.json?limit=250');
      const data = await res.json();
      const product = (data.products || []).find((p) => String(p.id) === String(productId));
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
        }
      } else {
      }
    } catch (e) {
    }
  }

  function applyCoupon(code) {
    if (appliedCouponCodes.includes(code)) {
      // Toggle off — remove the coupon
      appliedCouponCodes = [];
    } else {
      // Replace any existing coupon with the new one (only 1 at a time)
      appliedCouponCodes = [code];
    }
    sendClickEvent('coupon_click');
    renderDrawer();
  }

  /* =================== SCROLL HELPERS =================== */

  function ccScrollContainer(containerId, direction) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const scrollAmount = 290;
    el.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
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

    /* -------- HEADER -------- */
    drawerHtml += `
<div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
  <h3 style="margin:0;font-size:18px;font-weight:600;color:#000;">Your Cart</h3>
  <button onclick="document.querySelector('#cc-overlay').classList.remove('active');setTimeout(()=>{document.getElementById('cc-root').innerHTML=''},350);"
    style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px;">✕</button>
</div>
`;

    /* -------- BODY -------- */
    drawerHtml += `<div id="cc-drawer-body" style="flex:1;padding:16px 16px 40px 16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;">`;

    /* ---- PROGRESS BAR ---- */
    const progress = CONFIG.progress;
    if (progress.enabled && (progress.showOnEmpty || !isEmpty)) {
      const pInfo = getProgressInfo(cartTotal, cartQty, progress);

      const fgColor = progress.barForegroundColor || '#2563eb';

      drawerHtml += `<div style="padding:24px 16px;background:#fff;border-radius:16px;box-shadow:0 4px 20px -5px rgba(0,0,0,0.05);margin-bottom:20px;position:relative;border:1px solid #f1f5f9;">`;

      // Header info
      drawerHtml += `<div style="text-align:center;margin-bottom:28px;">`;
      if (pInfo.upcoming) {
        const amountLeft =
          pInfo.mode === 'quantity' ? `${Math.round(pInfo.nextAmount)} items` : `₹${Math.round(pInfo.nextAmount)}`;
        drawerHtml += `
    <p style="margin:0 0 4px 0;font-size:15px;font-weight:500;color:#64748b;">
      You're <span style="color:#0f172a;font-weight:700;">${amountLeft}</span> away
    </p>
    <p style="margin:0;font-size:14px;font-weight:700;color:${fgColor};">
      Unlock: ${pInfo.upcoming.rewardText}
    </p>
  `;
      } else {
        drawerHtml += `
    <div style="color:#10b981;display:flex;align-items:center;justify-content:center;gap:8px;">
      <span style="font-size:20px;">🎉</span>
      <span style="font-size:15px;font-weight:700;">${progress.completionText}</span>
    </div>
  `;
      }
      drawerHtml += `</div>`;

      // ---- PROGRESS TRACK with outline ----
      drawerHtml += `<div style="position:relative;width:calc(100% - 40px);height:10px;margin:24px 20px 48px 20px;background:${progress.barBackgroundColor || '#e2e8f0'
        };border-radius:99px;border:1.5px solid ${fgColor}22;box-shadow:inset 0 1px 3px rgba(0,0,0,0.06);">`;

      // 1. The progress bar filler
      drawerHtml += `<div style="position:absolute;left:0;top:0;height:100%;width:${pInfo.percentage}%;background:linear-gradient(90deg, ${fgColor}, ${fgColor}dd);border-radius:99px;transition:width 1s cubic-bezier(.4,0,.2,1);box-shadow:0 0 12px ${fgColor}44;z-index:1;display:block !important;overflow:hidden;font-size:0;line-height:0;">&nbsp;</div>`;

      // 2. Tier segment markers — thin lines on the track showing where each level is
      pInfo.tiers.forEach((ms) => {
        const segPercent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const reached = pInfo.currentVal >= ms.target;
        drawerHtml += `<div style="position:absolute;left:${segPercent}%;top:-3px;width:2px;height:calc(100% + 6px);background:${reached ? fgColor : '#cbd5e180'
          };border-radius:1px;z-index:0;display:block !important;">&nbsp;</div>`;
      });

      // 3. The milestone nodes
      pInfo.tiers.forEach((ms, idx) => {
        const isCompleted = pInfo.currentVal >= ms.target;
        const prevTarget = idx > 0 ? pInfo.tiers[idx - 1].target : 0;
        const isNext = !isCompleted && pInfo.currentVal >= prevTarget;
        const percent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
        const iconFill = isCompleted ? '#fff' : fgColor;
        const iconHtml = getMilestoneIconHtml(ms, iconFill);
        const nodeSize = isCompleted || isNext ? 40 : 32;
        const iconSize = isCompleted || isNext ? 20 : 16;

        drawerHtml += `<div style="position:absolute;left:${percent}%;top:50%;transform:translate(-50%,-50%);z-index:2;display:flex;flex-direction:column;align-items:center;">`;

        // Node circle — filled with fgColor when completed, white with outline when not
        drawerHtml += `<div style="width:${nodeSize}px;height:${nodeSize}px;border-radius:12px;background:${isCompleted ? fgColor : '#fff'
          };border:2.5px solid ${isCompleted ? fgColor : isNext ? fgColor : '#cbd5e1'
          };display:flex;align-items:center;justify-content:center;box-shadow:${isCompleted
            ? '0 4px 14px ' + fgColor + '55'
            : isNext
              ? '0 0 0 3px ' + fgColor + '22'
              : '0 2px 5px rgba(0,0,0,0.05)'
          };color:${iconFill};${isNext ? 'animation:cc-pulse-ring 2s infinite;--cc-fg-color66:' + fgColor + '66;' : ''
          }position:relative;transition:all .3s ease;">`;
        drawerHtml += `<span style="width:${iconSize}px;height:${iconSize}px;display:flex;align-items:center;justify-content:center;pointer-events:none;">${iconHtml}</span>`;
        // Completed checkmark badge
        if (isCompleted) {
          drawerHtml += `<span style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;"><svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        }
        drawerHtml += `</div>`;

        // Tooltip label
        const tooltipBottom = isCompleted ? '-48px' : '-32px';
        drawerHtml += `<div style="position:absolute;bottom:${tooltipBottom};left:50%;transform:translateX(-50%);white-space:nowrap;font-size:${isCompleted ? 12 : 11
          }px;font-weight:700;color:${isCompleted ? fgColor : '#64748b'};opacity:${isCompleted || isNext ? 1 : 0.7
          };pointer-events:none;z-index:10;display:flex;flex-direction:column;align-items:center;transition:all .3s ease;">`;
        if (isCompleted) {
          drawerHtml += `<span style="color:${fgColor};">${ms.rewardText}</span>`;
        } else {
          drawerHtml += `<span>${pInfo.mode === 'amount' ? '₹' + Math.round(ms.target) : ms.target}</span>`;
        }
        drawerHtml += `</div></div>`;
      });

      drawerHtml += `</div>`; // end progress track
      drawerHtml += `</div>`; // end progress container
    }

    /* ---- EMPTY STATE ---- */
    if (isEmpty) {
      drawerHtml += `
  <div style="padding:40px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;">
    <div style="font-size:40px;">🛒</div>
    <p style="margin:0;font-size:16px;font-weight:600;color:#111;">Your cart is empty</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Add items to unlock rewards</p>
  </div>
`;
    }

    /* ---- UPSELL (TOP POSITION) ---- */
    const upsell = CONFIG.upsell;
    let topUpsellHtml = '';
    let bottomUpsellHtml = '';

    // Prepare upsell html asynchronously before concatenating
    if (upsell.enabled && (upsell.showOnEmptyCart || !isEmpty)) {
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
            )}" style="width:100%;height:100%;object-fit:cover;">`
            : `<span style="font-size:32px;">📦</span>`
          }
      </div>
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(
            item.product_title
          )}</p>
          <button onclick="ccRemoveItem('${item.key}')"
            style="background:none;border:none;padding:4px;cursor:pointer;color:#94a3b8;font-size:16px;transition:color .2s;" title="Remove item">✕</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
          <div style="display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:14px;font-weight:700;color:#0f172a;">₹${unitPrice.toFixed(0)}</span>
              <span style="font-size:12px;color:#64748b;font-weight:500;">(${item.quantity} × ₹${unitPrice.toFixed(
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
              <span style="font-weight:800;font-size:15px;color:#0f172a;">₹${lineTotal.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
      });

      /* ---- COUPON SECTION ---- */
      const coupon = CONFIG.coupon;
      if (coupon.enabled && coupon.selectedActiveCoupons.length > 0) {
        drawerHtml += renderCouponSection(coupon, cartTotal);
      }
    }

    /* ---- UPSELL (BOTTOM POSITION) ---- */
    if (bottomUpsellHtml) {
      drawerHtml += bottomUpsellHtml;
    }

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
      <span style="font-size:14px;color:#0f172a;font-weight:700;">₹${subtotal.toFixed(0)}</span>
    </div>
`;

    if (totalDiscount > 0) {
      drawerHtml += `
    <div style="display:flex;justify-content:space-between;align-items:center;color:#10b981;">
      <span style="font-size:14px;font-weight:500;">Discounts</span>
      <span style="font-size:14px;font-weight:700;">-₹${totalDiscount.toFixed(0)}</span>
    </div>
`;
    }

    drawerHtml += `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-top:10px;border-top:1px solid #f1f5f9;">
      <span style="font-size:16px;color:#0f172a;font-weight:800;">Total</span>
      <span style="font-size:18px;color:#0f172a;font-weight:900;">₹${finalTotal.toFixed(0)}</span>
    </div>
  </div>
  <a href="/checkout" style="text-decoration:none;" onclick="ccSendClickEvent('checkout_click')">
    <button style="width:100%;padding:16px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);transition:all .2s ease;">
      Checkout Now <span style="font-size:18px;">→</span>
    </button>
  </a>
  <p style="margin:12px 0 0 0;text-align:center;font-size:11px;color:#94a3b8;font-weight:500;">
    Shipping and taxes calculated at checkout
  </p>
</div>
`;

    // ---- SMOOTH DOM UPDATE ----
    if (isFirstOpen) {
      // First open: build full overlay with backdrop + drawer
      overlay.innerHTML = `<div id="cc-backdrop"></div><div id="cc-drawer">${drawerHtml}</div>`;
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

    // Use allCouponDetails from DB as primary source (has all visual styles saved)
    // Fall back to COUPONS API + overrides only if allCouponDetails is empty
    const couponsToShow = selectedIds
      .map((id) => {
        // 1. Check if we have saved details from DB
        const saved = savedDetails.find((d) => d.id === id);
        if (saved) {
          const btn = saved.button || {};
          return {
            id,
            code: saved.code || 'CODE',
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
              (apiCoupon.type === 'amount_off_order' ? 'Order Discount' : 'Product Discount'),
            discountType: apiCoupon.valueType === 'percentage' ? 'percentage' : 'fixed',
            discountValue: parseFloat(override.discountValue || apiCoupon.value || 0),
            backgroundColor: override.backgroundColor || apiCoupon.backgroundColor || '#6366f1',
            textColor: override.textColor || apiCoupon.textColor || '#ffffff',
            iconUrl: override.iconUrl || apiCoupon.iconUrl || '🎟️',
            buttonText:
              override['button.text'] ??
              override.button?.text ??
              apiCoupon.buttonText ??
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
      'display:flex;flex-direction:row;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-ms-overflow-style:none;scrollbar-width:none;padding-bottom:4px;';

    let html = `
<div style="padding:16px;background:#fff;order:${couponConfig.position === 'top' ? -1 : 999};">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <p style="margin:0;font-size:14px;font-weight:700;color:#1e293b;">Available Offers</p>
    <div style="display:flex;gap:6px;">
      <button class="cc-nav-btn" onclick="ccCouponNav('left')" title="Previous coupon">←</button>
      <button class="cc-nav-btn" onclick="ccCouponNav('right')" title="Next coupon">→</button>
    </div>
  </div>
  <div id="cc-coupon-list" class="cc-hide-scrollbar" style="${couponListStyle}">
`;

    couponsToShow.forEach((coupon) => {
      const isApplied = appliedCouponCodes.includes(coupon.code);

      if (style === 'style-1') {
        // Style 1: White card with colored left accent bar, grey icon box, dark text, outlined button
        html += `
    <div data-coupon-card style="min-width:240px;flex:0 0 auto;scroll-snap-align:start;padding:12px 16px;background:#fff;border-radius:8px;border:${isApplied ? '1px solid ' + coupon.backgroundColor : '1px solid #e2e8f0'
          };box-shadow:${isApplied ? '0 2px 8px ' + coupon.backgroundColor + '30' : '0 2px 4px rgba(0,0,0,0.02)'
          };display:flex;align-items:center;gap:12px;position:relative;overflow:hidden;transition:all 0.2s ease;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${coupon.backgroundColor};"></div>
      <div style="width:46px;height:46px;border-radius:8px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${coupon.iconUrl
          }</div>
      <div style="flex:1;min-width:0;">
        <p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#1e293b;">${escapeHtml(coupon.code)}</p>
        <p style="margin:0;font-size:13px;color:#64748b;">${escapeHtml(coupon.label)}</p>
      </div>
      <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="padding:6px 14px;background:${isApplied ? coupon.backgroundColor : 'transparent'
          };color:${isApplied ? '#fff' : '#475569'};border:${isApplied ? '1px solid ' + coupon.backgroundColor : '1px solid #cbd5e1'
          };border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.2s ease;">${isApplied ? 'Applied' : 'Apply'
          }</button>
    </div>
  `;
      } else if (style === 'style-2') {
        // Style 2: White card, filled colored icon box, dark text, black Apply Coupon button
        html += `
    <div data-coupon-card style="min-width:180px;flex:0 0 auto;scroll-snap-align:start;padding:16px;background:#fff;border-radius:16px;border:${isApplied ? '2px solid ' + coupon.backgroundColor : '1px solid #e2e8f0'
          };box-shadow:0 4px 12px rgba(0,0,0,0.08);display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;position:relative;">
      <div style="width:56px;height:56px;border-radius:16px;background:${coupon.backgroundColor
          };display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;box-shadow:0 4px 10px ${coupon.backgroundColor
          }60;">${coupon.iconUrl}</div>
      <div>
        <p style="margin:0 0 2px 0;font-size:15px;font-weight:800;color:#1e293b;">${escapeHtml(coupon.code)}</p>
        <p style="margin:0;font-size:11px;color:#64748b;">${escapeHtml(coupon.description)}</p>
      </div>
      <button onclick="ccApplyCoupon('${escapeHtml(
            coupon.code
          )}')" style="width:100%;padding:8px;margin-top:4px;background:${isApplied ? '#10b981' : '#1e293b'
          };color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">${isApplied ? '✓ Applied' : 'Apply Coupon'
          }</button>
    </div>
  `;
      } else {
        // Style 3: Colored header + white body with dashed code box + text-link apply button
        html += `
    <div data-coupon-card style="min-width:280px;flex:0 0 auto;scroll-snap-align:start;padding:0;background:#fff;border-radius:12px;border:1px solid #e2e8f0;box-shadow:0 2px 6px rgba(0,0,0,0.04);display:flex;flex-direction:column;overflow:hidden;">
      <div style="background:${coupon.backgroundColor
          };padding:12px 16px;display:flex;align-items:center;justify-content:space-between;color:${coupon.textColor};">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">${coupon.iconUrl}</span>
          <span style="font-size:14px;font-weight:700;">${escapeHtml(coupon.label)}</span>
        </div>
        <div style="background:rgba(255,255,255,0.2);padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;">${coupon.discountValue
          }% OFF</div>
      </div>
      <div style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="flex:1;border:1px dashed #cbd5e1;border-radius:6px;padding:6px 10px;background:#f8fafc;">
          <p style="margin:0;font-size:13px;font-weight:700;color:#334155;font-family:monospace;">${escapeHtml(
            coupon.code
          )}</p>
        </div>
        <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="border:none;background:none;color:${isApplied ? '#10b981' : '#2563eb'
          };font-size:12px;font-weight:700;cursor:pointer;padding:4px;">${isApplied ? 'REMOVE' : 'APPLY'}</button>
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

    if (upsellConfig.useAI && upsellConfig.aiApiKey) {
      // Wait for AI recommendations
      try {
        const aiRes = await originalFetch('https://blueviolet-clam-512487.hostingersite.com/ai_upsell.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: upsellConfig.aiApiKey,
            cartProducts: cart.items.map(i => ({ title: i.product_title, id: i.product_id })),
            // Pass available manual rules pool as catalog to choose from, or a limited catalog
            allProducts: (upsellConfig.manualRules || []).flatMap(r => r.upsellProductDetails || [])
          })
        });

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          if (aiData.success && aiData.recommendations) {
            upsellProducts = aiData.recommendations;
            // Build matched details from the existing details
            const allDetails = (upsellConfig.manualRules || []).flatMap(r => r.upsellProductDetails || []);
            upsellProducts.forEach(id => {
              const detail = allDetails.find(d => String(d.id).includes(id) || String(d.variantId) == String(id));
              if (detail) matchedUpsellDetails.push(detail);
            });
          }
        }
      } catch (e) { console.warn('AI Upsell failed:', e); }
    }

    if (upsellProducts.length === 0 && upsellConfig.manualRules) {
      for (const rule of upsellConfig.manualRules) {
        if (rule.enabled === false) continue;
        const triggerIds = (rule.triggerProductIds || []).map(id => String(id).replace('gid://shopify/Product/', ''));
        if (rule.triggerType === 'all' || triggerIds.some(id => cartProductIds.includes(id)) || triggerIds.length === 0) {
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

    const dir = upsellConfig.direction || 'vertical';
    const layout = upsellConfig.layout || 'carousel';
    const titleStyle = `
      font-size:12px;
      font-weight:${upsellConfig.upsellTitle.bold ? 900 : 800};
      font-style:${upsellConfig.upsellTitle.italic ? 'italic' : 'normal'};
      text-decoration:${upsellConfig.upsellTitle.underline ? 'underline' : 'none'};
      color:${upsellConfig.upsellTitle.color};
      text-transform:uppercase;letter-spacing:.05em;
    `;

    const isHorizontal = dir === 'horizontal';
    const isVertical = dir === 'vertical';
    const isCarousel = layout === 'carousel';
    const isGrid = layout === 'grid';
    const showUpsellNav = upsellProducts.length >= 2 && isCarousel;

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
<div style="padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;${upsellConfig.position === 'top' ? 'border-top:1px solid #e5e7eb;margin-top:8px;' : ''
      }flex-shrink:0;">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <p style="margin:0;${titleStyle}">${escapeHtml(upsellConfig.upsellTitle.text)}</p>
    ${showUpsellNav
        ? `<div style="display:flex;gap:6px;">
      <button id="upsell-nav-left" class="cc-nav-btn" onclick="ccScrollContainer('cc-upsell-list','left')" title="Scroll left" style="display:none;">←</button>
      <button id="upsell-nav-right" class="cc-nav-btn" onclick="ccScrollContainer('cc-upsell-list','right')" title="Scroll right" style="display:none;">→</button>
    </div>`
        : ''
      }
  </div>
  <div class="cc-hide-scrollbar" style="${listStyle}" id="cc-upsell-list">
`;

    upsellProducts.forEach((productId) => {
      const detail =
        (matchedUpsellDetails || []).find(
          (d) => String(d.id).replace('gid://shopify/Product/', '') === productId
        ) || {};
      const title = detail.title || 'Product';
      const priceText = detail.price ? '₹' + parseFloat(detail.price).toFixed(0) : '';
      const imageHtml =
        detail.image && detail.image !== '📦' && detail.image !== null
          ? `<img src="${detail.image}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
          : `<span style="font-size:20px;color:#94a3b8;">📦</span>`;

      const addToCartId = detail.variantId || productId;

      if (isGrid) {
        // GRID CARD: Always Square Design (Image on Top, Content Below)
        const gridCardStyle = isVertical ? 'max-width: calc(50% - 8px);' : '';
        html += `
          <div class="cc-upsell-card cc-layout-grid" style="${gridCardStyle}">
            <div class="cc-upsell-image-wrapper">
              ${imageHtml}
            </div>
            <div class="cc-upsell-content">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:700;color:#1e293b;
                line-height:1.2;width:100%;text-align:left;">${escapeHtml(title)}</p>
              <div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;margin-top:auto;">
                <span style="font-size:12px;font-weight:800;color:#10b981;">${priceText}</span>
                <button onclick="ccAddToCart('${addToCartId}', true)" class="cc-add-btn" style="padding:4px 10px;font-size:10px;">Add</button>
              </div>
            </div>
          </div>
        `;
      } else {
        // CAROUSEL CARD: Always Rectangular Design (Image Left, Content Right)
        const cardSpecialStyle = isHorizontal
          ? 'min-width: 320px; max-width: 320px; scroll-snap-align: start;'
          : '';
        html += `
          <div class="cc-upsell-card cc-layout-carousel" style="${cardSpecialStyle} border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <div class="cc-upsell-image-wrapper">
              ${imageHtml}
            </div>
            <div class="cc-upsell-content">
              <div class="cc-carousel-info" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0; text-align: left;">
                <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;line-height:1.3;word-break: break-word;">${escapeHtml(
          title
        )}</p>
                <span style="font-size:15px;font-weight:800;color:#10b981;">${priceText}</span>
              </div>
              <button onclick="ccAddToCart('${addToCartId}', true)" class="cc-add-btn" style="padding:10px 24px; font-size:12px; border-radius: 30px; letter-spacing: 0.5px; margin-left:8px;">ADD</button>
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
          const scrollLeft = list.scrollLeft;
          const scrollTop = list.scrollTop;
          const items = list.querySelectorAll('.cc-upsell-card');
          if (items.length === 0) return;

          if (isHorizontal) {
            leftBtn.style.display = scrollLeft > 5 ? 'flex' : 'none';
            const lastItem = items[items.length - 1];
            const rect = lastItem.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const visibleWidth = Math.max(
              0,
              Math.min(rect.right, listRect.right) - Math.max(rect.left, listRect.left)
            );
            const visibilityRatio = visibleWidth / rect.width;
            rightBtn.style.display = visibilityRatio < 0.5 ? 'flex' : 'none';
          } else {
            // Vertical Carousel navigation
            leftBtn.style.display = scrollTop > 5 ? 'flex' : 'none';
            const lastItem = items[items.length - 1];
            const rect = lastItem.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const visibleHeight = Math.max(
              0,
              Math.min(rect.bottom, listRect.bottom) - Math.max(rect.top, listRect.top)
            );
            const visibilityRatio = visibleHeight / rect.height;
            rightBtn.style.display = visibilityRatio < 0.5 ? 'flex' : 'none';
          }
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

  window.ccAddToCart = function (variantId, isUpsell) {
    if (isUpsell) sendClickEvent('upsell_click');
    addToCart(variantId, 1);
  };

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
