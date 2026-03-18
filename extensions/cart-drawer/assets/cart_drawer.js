(function () {
    console.log('[CartDrawer] Custom Cart Loaded - v2.1 (Strict Layout/Direction)');

    const container = document.getElementById('cc-root');
    if (!container) return;
    const SHOP = container.dataset.shop;
    const API_BASE = '/apps/cart-app/';
    const CONFIG_API = API_BASE + '/save_cart_drawer.php?shopdomain=' + SHOP;
    const COUPON_API = API_BASE + '/save_coupon.php?shopdomain=' + SHOP;

    let CONFIG = null;
    let COUPONS = [];
    let appliedCouponCodes = [];

    /* =================== LOAD CONFIG =================== */

    async function loadConfig() {
        try {
            const fetchOptions = {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                    'ngrok-skip-browser-warning': 'true',
                },
            };

            const [configRes, couponRes] = await Promise.all([
                fetch(CONFIG_API, fetchOptions),
                fetch(COUPON_API, fetchOptions).catch(() => null),
            ]);

            if (!configRes || !configRes.ok) {
                throw new Error('Config API request failed');
            }

            const configJson = await configRes.json();

            if (configJson.status === 'success' && configJson.data) {
                const d = configJson.data;

                const cartActive = d.cartStatus == 1 || d.cart_status == 1 || d.cartstatus === 'active';

                console.log('[CartDrawer] Config fetched:', d);
                console.log('[CartDrawer] Cart active status:', cartActive);

                if (!cartActive) {
                    console.warn('[CartDrawer] Cart NOT active');
                    CONFIG = null;
                    return;
                }

                CONFIG = {
                    cartStatus: true,
                    progress: parseProgressData(d),
                    coupon: parseCouponData(d),
                    upsell: parseUpsellData(d),
                };

                // Enrich upsell products with title/price/image from Shopify AJAX API
                await enrichUpsellProducts(CONFIG.upsell);
            }

            // Coupons
            if (couponRes && couponRes.ok) {
                try {
                    const couponJson = await couponRes.json();

                    if (couponJson.status === 'success' && Array.isArray(couponJson.data)) {
                        COUPONS = couponJson.data;
                    }
                } catch (e) {
                    console.warn('[CartDrawer] Coupon JSON parse error', e);
                }
            }
        } catch (e) {
            console.error('[CartDrawer] Config load error:', e);
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
        const mode = data.mode || (data.rewardsCalculation?.[0] === 'cartQuantity' ? 'quantity' : 'amount');

        const rawTiers = Array.isArray(data.tiers) ? data.tiers : [];
        const parsedTiers = rawTiers
            .map((t) => {
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
        const needsEnrichment = (upsell.manualRules || []).some((rule) =>
            (rule.upsellProductDetails || []).some((d) => !d.title || !d.price || !d.variantId)
        );
        if (!needsEnrichment) return;

        try {
            const res = await originalFetch('/products.json?limit=250');
            const data = await res.json();
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
                        } catch (innerErr) { }
                    }
                }
            }
        } catch (e) { }
    }

    /* =================== OPEN DRAWER =================== */

    async function openDrawer() {
        if (!CONFIG) await loadConfig();
        if (!CONFIG) return;
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
    let _ccOpenTimer = null;
    function scheduleOpenDrawer(delay) {
        if (_ccOpenTimer) clearTimeout(_ccOpenTimer);
        _ccOpenTimer = setTimeout(function () {
            _ccOpenTimer = null;
            openDrawer();
        }, delay || 350);
    }

    /* =================== CART ACTION INTERCEPTS =================== */

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
            if (url.includes('/cart/add')) {
                scheduleOpenDrawer(350);
            }
        } catch (e) { }
        return response;
    };

    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (url && url.includes('/cart/add')) {
            this.addEventListener('load', function () {
                scheduleOpenDrawer(350);
            });
        }
        return originalXHROpen.apply(this, arguments);
    };

    document.addEventListener('submit', function (e) {
        const form = e.target;
        if (form && form.action && form.action.includes('/cart/add')) {
            scheduleOpenDrawer(500);
        }
    });

    [
        'cart:item-added',
        'cart:updated',
        'cart:add',
        'cart:refresh',
        'on:cart:add',
        'shopify:cart:added',
        'theme:cart:open',
        'cart:open',
    ].forEach(function (evt) {
        document.addEventListener(evt, function () { scheduleOpenDrawer(300); });
        window.addEventListener(evt, function () { scheduleOpenDrawer(300); });
    });

    document.addEventListener('click', function (e) {
        if (e.target.closest('[name="add"],[data-add-to-cart],[data-action="add-to-cart"],.btn-add-to-cart,.add-to-cart,.product-form__submit')) {
            scheduleOpenDrawer(600);
        }
    }, true);

    document.addEventListener('shopify:section:load', function () {
        if (new URL(location.href).searchParams.get('added')) scheduleOpenDrawer(100);
    });

    function ccWatchCartCount() {
        const el = document.querySelector('[data-cart-count],[data-cart-item-count],.cart-count,.cart__item-count,.CartCount,#cart-icon-bubble');
        if (!el || el._ccWatching) return;
        el._ccWatching = true;
        let lastCount = parseInt(el.textContent || el.getAttribute('data-cart-count') || 0);
        new MutationObserver(function () {
            const now = parseInt(el.textContent || el.getAttribute('data-cart-count') || 0);
            if (now > lastCount) {
                scheduleOpenDrawer(200);
            }
            lastCount = now;
        }).observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    }
    ccWatchCartCount();
    document.addEventListener('DOMContentLoaded', ccWatchCartCount);
    window.addEventListener('load', ccWatchCartCount);

    /* =================== CART ACTIONS =================== */

    let _ccUpdating = false;

    async function updateQuantity(key, quantity) {
        if (_ccUpdating) return;
        _ccUpdating = true;
        try {
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
            const res = await originalFetch('/cart/add.js', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: [{ id: variantId, quantity: quantity || 1 }] }),
            });
            if (res.ok) {
                setTimeout(() => renderDrawer(), 300);
                setTimeout(() => renderDrawer(), 800);
            }
        } catch (e) { }
    }

    function applyCoupon(code) {
        if (appliedCouponCodes.includes(code)) {
            appliedCouponCodes = [];
        } else {
            appliedCouponCodes = [code];
        }
        renderDrawer();
    }

    /* =================== SCROLL HELPERS =================== */

    function ccScrollContainer(containerId, direction) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const scrollAmount = 290;
        el.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }

    function ccCouponNav(direction) {
        const el = document.getElementById('cc-coupon-list');
        if (!el) return;
        const card = el.querySelector('[data-coupon-card]');
        if (!card) return;
        const cardWidth = card.offsetWidth + 12;
        el.scrollBy({ left: direction === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' });
    }

    /* =================== PROGRESS HELPERS =================== */

    function getProgressInfo(cartTotal, cartQty, progress) {
        const mode = progress.mode;
        const currentVal = mode === 'quantity' ? cartQty || 0 : cartTotal || 0;
        const tiers = progress.tiers || [];
        const maxTarget = progress.maxTarget || 1000;

        const completed = tiers.filter((t) => currentVal >= t.target);
        const upcoming = tiers.find((t) => t.target > currentVal);
        const nextAmount = upcoming ? upcoming.target - currentVal : 0;

        let percentage = maxTarget > 0 ? (currentVal / maxTarget) * 100 : 0;
        if (isNaN(percentage) || !isFinite(percentage)) percentage = 0;
        percentage = Math.min(100, Math.max(0, percentage));

        return { currentVal, maxTarget, completed, upcoming, nextAmount, percentage, mode, tiers };
    }

    const CC_ICON_PRESETS = {
        gift: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"/></svg>',
        shipping: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 18.5a1.5 1.5 0 0 1-1.5-1.5 1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5m1.5-9 1.96 2.5H17V9.5m-11 9A1.5 1.5 0 0 1 4.5 17 1.5 1.5 0 0 1 6 15.5 1.5 1.5 0 0 1 7.5 17 1.5 1.5 0 0 1 6 18.5M20 8h-3V4H3c-1.11 0-2 .89-2 2v11h2a3 3 0 0 0 3 3 3 3 0 0 0 3-3h6a3 3 0 0 0 3 3 3 3 0 0 0 3-3h2v-5l-3-4Z"/></svg>',
        discount: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
        trophy: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.9 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 5h2v3H4V5zm7 10.93c-3.95-.49-7-3.85-7-7.93h14c0 4.08-3.05 7.44-7 7.93z"/><path d="M16 19H8v2h8z"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
        diamond: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 3H5L2 9l10 12L22 9l-3-6zM9.62 8l1.5-3h1.76l1.5 3H9.62zM11 10v6.68L5.44 10H11zm2 0h5.56L13 16.68V10zM19.26 8h-2.65l-1.5-3h2.65l1.5 3zM6.24 5h2.65l-1.5 3H4.74l1.5-3z"/></svg>',
        lock: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
    };

    function getMilestoneIconHtml(tier, fillColor) {
        let svg = tier.iconType === 'custom' && tier.iconCustomSvg ? tier.iconCustomSvg : (CC_ICON_PRESETS[tier.iconPreset] || CC_ICON_PRESETS.gift);
        if (fillColor) {
            svg = svg.replace(/fill="currentColor"/g, 'fill="' + fillColor + '"')
                .replace(/stroke="currentColor"/g, 'stroke="' + fillColor + '"')
                .replace(/fill:\s*currentColor/g, 'fill: ' + fillColor)
                .replace(/stroke:\s*currentColor/g, 'stroke: ' + fillColor);
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

        let savedScroll = 0;
        const existingBody = document.getElementById('cc-drawer-body');
        if (existingBody) savedScroll = existingBody.scrollTop;

        if (isFirstOpen) {
            overlay = document.createElement('div');
            overlay.id = 'cc-overlay';
        }

        let drawerHtml = `
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <h3 style="margin:0;font-size:18px;font-weight:600;color:#000;">Your Cart</h3>
        <button onclick="document.querySelector('#cc-overlay').classList.remove('active');setTimeout(()=>{document.getElementById('cc-root').innerHTML=''},350);"
          style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;padding:4px;">✕</button>
      </div>
      <div id="cc-drawer-body" style="flex:1;padding:16px 16px 40px 16px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;">
    `;

        const progress = CONFIG.progress;
        if (progress.enabled && (progress.showOnEmpty || !isEmpty)) {
            const pInfo = getProgressInfo(cartTotal, cartQty, progress);
            const fgColor = progress.barForegroundColor || '#2563eb';
            drawerHtml += `<div style="padding:24px 16px;background:#fff;border-radius:16px;box-shadow:0 4px 20px -5px rgba(0,0,0,0.05);margin-bottom:20px;position:relative;border:1px solid #f1f5f9;">
        <div style="text-align:center;margin-bottom:28px;">`;
            if (pInfo.upcoming) {
                const amountLeft = pInfo.mode === 'quantity' ? `${Math.round(pInfo.nextAmount)} items` : `₹${Math.round(pInfo.nextAmount)}`;
                drawerHtml += `<p style="margin:0 0 4px 0;font-size:15px;font-weight:500;color:#64748b;">You're <span style="color:#0f172a;font-weight:700;">${amountLeft}</span> away</p>
                       <p style="margin:0;font-size:14px;font-weight:700;color:${fgColor};">Unlock: ${pInfo.upcoming.rewardText}</p>`;
            } else {
                drawerHtml += `<div style="color:#10b981;display:flex;align-items:center;justify-content:center;gap:8px;"><span style="font-size:20px;">🎉</span><span style="font-size:15px;font-weight:700;">${progress.completionText}</span></div>`;
            }
            drawerHtml += `</div><div style="position:relative;width:calc(100% - 40px);height:10px;margin:24px 20px 48px 20px;background:${progress.barBackgroundColor || '#e2e8f0'};border-radius:99px;border:1.5px solid ${fgColor}22;box-shadow:inset 0 1px 3px rgba(0,0,0,0.06);">
        <div style="position:absolute;left:0;top:0;height:100%;width:${pInfo.percentage}%;background:linear-gradient(90deg, ${fgColor}, ${fgColor}dd);border-radius:99px;transition:width 1s cubic-bezier(.4,0,.2,1);box-shadow:0 0 12px ${fgColor}44;z-index:1;">&nbsp;</div>`;
            pInfo.tiers.forEach((ms, idx) => {
                const isCompleted = pInfo.currentVal >= ms.target;
                const percent = Math.min(97, Math.max(3, (ms.target / pInfo.maxTarget) * 100));
                const iconFill = isCompleted ? '#fff' : fgColor;
                const iconHtml = getMilestoneIconHtml(ms, iconFill);
                const nodeSize = isCompleted ? 40 : 32;
                drawerHtml += `<div style="position:absolute;left:${percent}%;top:50%;transform:translate(-50%,-50%);z-index:2;display:flex;flex-direction:column;align-items:center;">
          <div style="width:${nodeSize}px;height:${nodeSize}px;border-radius:12px;background:${isCompleted ? fgColor : '#fff'};border:2.5px solid ${fgColor};display:flex;align-items:center;justify-content:center;color:${iconFill};">
            <span style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;">${iconHtml}</span>
          </div>
        </div>`;
            });
            drawerHtml += `</div></div>`;
        }

        if (isEmpty) {
            drawerHtml += `<div style="padding:40px 0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;">
        <div style="font-size:40px;">🛒</div><p style="margin:0;font-size:16px;font-weight:600;color:#111;">Your cart is empty</p>
      </div>`;
        }

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

        if (!isEmpty) {
            cart.items.forEach((item) => {
                const unitPrice = item.original_price / 100;
                const lineTotal = item.final_line_price / 100;
                drawerHtml += `<div style="display:flex;gap:12px;padding:12px;background:#fff;border-radius:16px;border:1px solid #f1f5f9;position:relative;">
          <div style="width:70px;height:70px;background:#fff;border-radius:12px;flex-shrink:0;border:1px solid #f1f5f9;overflow:hidden;display:flex;align-items:center;justify-content:center;">
            ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.product_title)}" style="width:100%;height:100%;object-fit:cover;">` : `📦`}
          </div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(item.product_title)}</p>
              <button onclick="ccRemoveItem('${item.key}')" style="background:none;border:none;padding:4px;cursor:pointer;color:#94a3b8;font-size:16px;">✕</button>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:14px;font-weight:700;color:#0f172a;">₹${unitPrice.toFixed(0)}</span>
                <span style="font-size:12px;color:#64748b;font-weight:500;">(${item.quantity})</span>
              </div>
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="display:flex;align-items:center;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;padding:2px;">
                  <button class="cc-qty-btn" onclick="ccUpdateQty('${item.key}',${item.quantity - 1})">−</button>
                  <span style="width:24px;text-align:center;font-size:13px;font-weight:700;color:#1e293b;">${item.quantity}</span>
                  <button class="cc-qty-btn" onclick="ccUpdateQty('${item.key}',${item.quantity + 1})">+</button>
                </div>
                <div style="text-align:right;min-width:60px;"><span style="font-weight:800;font-size:15px;color:#0f172a;">₹${lineTotal.toFixed(0)}</span></div>
              </div>
            </div>
          </div>
        </div>`;
            });
            const coupon = CONFIG.coupon;
            if (coupon.enabled && coupon.selectedActiveCoupons.length > 0) {
                drawerHtml += renderCouponSection(coupon, cartTotal);
            }
        }

        if (bottomUpsellHtml) {
            drawerHtml += bottomUpsellHtml;
        }

        drawerHtml += `</div>`; // end body

        const subtotal = cartTotal;
        let totalDiscount = 0;
        const allDetails = (CONFIG.coupon && CONFIG.coupon.allCouponDetails) || [];
        appliedCouponCodes.forEach((code) => {
            const apiMatch = COUPONS.find((c) => c.code === code);
            const savedMatch = allDetails.find((c) => c.code === code);
            let val = 0; let isPercentage = false;
            if (apiMatch && (apiMatch.value || apiMatch.discountValue)) {
                val = parseFloat(apiMatch.value || apiMatch.discountValue || 0);
                isPercentage = apiMatch.valueType === 'percentage' || apiMatch.discountType === 'percentage';
            } else if (savedMatch && savedMatch.discountValue) {
                val = parseFloat(savedMatch.discountValue || 0);
                isPercentage = savedMatch.discountType === 'percentage';
            }
            if (val > 0) {
                if (isPercentage) totalDiscount += subtotal * (val / 100);
                else totalDiscount += val;
            }
        });
        const finalTotal = Math.max(0, subtotal - totalDiscount);

        drawerHtml += `<div style="padding:20px;background:#fff;border-top:1px solid #f1f5f9;box-shadow:0 -4px 6px -1px rgba(0,0,0,0.05);flex-shrink:0;">
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:14px;color:#64748b;font-weight:500;">Subtotal</span><span style="font-size:14px;color:#0f172a;font-weight:700;">₹${subtotal.toFixed(0)}</span></div>
        ${totalDiscount > 0 ? `<div style="display:flex;justify-content:space-between;align-items:center;color:#10b981;"><span style="font-size:14px;font-weight:500;">Discounts</span><span style="font-size:14px;font-weight:700;">-₹${totalDiscount.toFixed(0)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding-top:10px;border-top:1px solid #f1f5f9;"><span style="font-size:16px;color:#0f172a;font-weight:800;">Total</span><span style="font-size:18px;color:#0f172a;font-weight:900;">₹${finalTotal.toFixed(0)}</span></div>
      </div>
      <a href="/checkout" style="text-decoration:none;"><button style="width:100%;padding:16px;background:#111827;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">Checkout Now →</button></a>
    </div>`;

        if (isFirstOpen) {
            overlay.innerHTML = `<div id="cc-backdrop"></div><div id="cc-drawer">${drawerHtml}</div>`;
            root.appendChild(overlay);
            requestAnimationFrame(() => { overlay.classList.add('active'); });
            document.getElementById('cc-backdrop').addEventListener('click', closeDrawer);
        } else {
            const drawer = document.getElementById('cc-drawer');
            if (drawer) drawer.innerHTML = drawerHtml;
            overlay.classList.add('active');
            const newBody = document.getElementById('cc-drawer-body');
            if (newBody && savedScroll > 0) newBody.scrollTop = savedScroll;
        }
    }

    function renderCouponSection(couponConfig, cartTotal) {
        const selectedIds = couponConfig.selectedActiveCoupons || [];
        const savedDetails = couponConfig.allCouponDetails || [];
        const couponsToShow = selectedIds.map(id => {
            const saved = savedDetails.find(d => d.id === id);
            if (saved) {
                return {
                    id, code: saved.code || 'CODE', label: saved.label || 'Offer', backgroundColor: saved.backgroundColor || '#000', iconUrl: saved.iconUrl || '🎟️'
                };
            }
            return null;
        }).filter(c => c);

        if (couponsToShow.length === 0) return '';
        let html = `<div style="padding:16px;background:#fff;order:${couponConfig.position === 'top' ? -1 : 999};">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><p style="margin:0;font-size:14px;font-weight:700;color:#1e293b;">Available Offers</p></div>
      <div id="cc-coupon-list" class="cc-hide-scrollbar" style="display:flex;gap:12px;overflow-x:auto;">`;

        couponsToShow.forEach(coupon => {
            const isApplied = appliedCouponCodes.includes(coupon.code);
            html += `<div data-coupon-card style="min-width:180px;flex:0 0 auto;padding:16px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;display:flex;flex-direction:column;align-items:center;text-align:center;">
        <div style="width:56px;height:56px;border-radius:16px;background:${coupon.backgroundColor};display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;">${coupon.iconUrl}</div>
        <p style="margin:8px 0 2px 0;font-size:15px;font-weight:800;color:#1e293b;">${escapeHtml(coupon.code)}</p>
        <button onclick="ccApplyCoupon('${escapeHtml(coupon.code)}')" style="width:100%;padding:8px;background:${isApplied ? '#10b981' : '#1e293b'};color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:600;">${isApplied ? '✓ Applied' : 'Apply Coupon'}</button>
      </div>`;
        });
        html += `</div></div>`;
        return html;
    }

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
        if (!upsellConfig.showIfInCart) upsellProducts = upsellProducts.filter(id => !cartProductIds.includes(String(id)));
        if (upsellConfig.limit) upsellProducts = upsellProducts.slice(0, upsellConfig.limit);
        if (upsellProducts.length === 0) return '';

        let html = `<div style="padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e5e7eb;"><p style="margin:0;font-size:12px;font-weight:800;text-transform:uppercase;">${escapeHtml(upsellConfig.upsellTitle.text)}</p>
      <div class="cc-hide-scrollbar" style="display:flex;gap:12px;overflow-x:auto;" id="cc-upsell-list">`;

        upsellProducts.forEach(productId => {
            const d = matchedUpsellDetails.find(m => String(m.id).includes(productId)) || {};
            html += `<div class="cc-upsell-card" style="min-width:300px;background:#fff;padding:12px;border-radius:12px;display:flex;gap:12px;">
        <div style="width:70px;height:70px;border-radius:8px;overflow:hidden;">${d.image ? `<img src="${d.image}" style="width:100%;height:100%;object-fit:cover;">` : '📦'}</div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
          <p style="margin:0;font-size:13px;font-weight:700;">${escapeHtml(d.title || 'Product')}</p>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
            <span style="font-weight:800;color:#10b981;">₹${parseFloat(d.price || 0).toFixed(0)}</span>
            <button onclick="ccAddToCart('${d.variantId || productId}')" class="cc-add-btn">Add</button>
          </div>
        </div>
      </div>`;
        });
        html += `</div></div>`;
        return html;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    window.ccUpdateQty = (key, qty) => updateQuantity(key, Math.max(0, qty));
    window.ccRemoveItem = (key) => removeItem(key);
    window.ccAddToCart = (vId) => addToCart(vId, 1);
    window.ccApplyCoupon = (code) => applyCoupon(code);
    window.ccScrollContainer = (id, dir) => ccScrollContainer(id, dir);
    window.ccCouponNav = (dir) => ccCouponNav(dir);

    loadConfig();
})();
