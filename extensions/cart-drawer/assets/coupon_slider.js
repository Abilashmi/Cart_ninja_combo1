(function () {
    const containers = document.querySelectorAll('[id^="ps-coupon-slider-"]');

    containers.forEach(container => {
        if (container._initialized) return;
        container._initialized = true;

        const shopDomain = container.dataset.shop;

        const normalizeId = (id) => {
            if (!id || typeof id !== 'string') return id;
            let clean = id.replace(/\\/g, '/').replace(/\/+/g, '/');
            if (clean.startsWith('gid:/') && !clean.startsWith('gid://')) {
                clean = clean.replace('gid:/', 'gid://');
            }
            return clean;
        };

        const safeParse = (val, isArray = true) => {
            if (!val) return isArray ? [] : {};
            if (typeof val === 'object') return val;
            try {
                return JSON.parse(val);
            } catch (e) {
                if (!isArray) return {};
                const matches = val.match(/gid:[\/\\]+shopify[\/\\]+(DiscountCodeNode|DiscountAutomaticNode|DiscountNode)[\/\\]+\d+/g);
                return (matches || []).map(normalizeId);
            }
        };

        const API_URL = 'https://blueviolet-clam-512487.hostingersite.com/save_coupon_slider_widget.php?shopdomain=' + shopDomain;

        fetch(API_URL)
            .then((res) => res.text())
            .then((text) => {
                const isTruncated = text.length > 0 && !text.trim().endsWith('}');
                const lastSaveMatch = text.match(/"updated_at"\s*:\s*"([^"]+)"/);
                const lastSave = lastSaveMatch ? lastSaveMatch[1] : 'Unknown';

                let data = null;
                try {
                    const response = JSON.parse(text);
                    if (response && response.status === 'success') data = response.data;
                } catch (e) {
                    console.warn('[Coupon Slider] Corrupted data detected.');
                }

                if (!data || !data.selectedTemplateCoupon) {
                    const gids = text.match(/gid:[\/\\]+shopify[\/\\]+(DiscountCodeNode|DiscountAutomaticNode|DiscountNode)[\/\\]+\d+/g) || [];
                    const templateMatch = text.match(/"selectedTemplate"\s*:\s*"([^"]+)"/);
                    data = {
                        selectedTemplate: templateMatch ? templateMatch[1] : 'template1',
                        selectedTemplateCoupon: [...new Set(gids)].map((id) => id.replace(/\\/g, '/').replace(/\/+/g, '/')),
                    };
                }

                const selectedTemplate = data.selectedTemplate || 'template1';

                let defaultStyle = safeParse(data.temp1DefaultStyle || data.temp2DefaultStyle || data.temp3DefaultStyle || data.temp4DefaultStyle, false);
                let couponStyleMap = {};
                let rawCouponIds = safeParse(data.selectedTemplateCoupon, true);

                if (selectedTemplate === 'template1') {
                    defaultStyle = safeParse(data.temp1DefaultStyle, false);
                    couponStyleMap = safeParse(data.temp1CouponStyle, false);
                } else if (selectedTemplate === 'template2') {
                    defaultStyle = safeParse(data.temp2DefaultStyle, false);
                    couponStyleMap = safeParse(data.temp2CouponStyle, false);
                } else if (selectedTemplate === 'template3') {
                    defaultStyle = safeParse(data.temp3DefaultStyle, false);
                    couponStyleMap = safeParse(data.temp3CouponStyle, false);
                } else if (selectedTemplate === 'template4') {
                    defaultStyle = safeParse(data.temp4DefaultStyle, false);
                    couponStyleMap = safeParse(data.temp4CouponStyle, false);
                }

                const styleMapKeys = Object.keys(couponStyleMap || {}).map(normalizeId);
                const resolvedIds = rawCouponIds.map((raw) => {
                    const normRaw = normalizeId(raw);
                    const match = styleMapKeys.find((full) => full.startsWith(normRaw) || normRaw.startsWith(full));
                    return match || normRaw;
                });

                const couponIds = [...new Set([...resolvedIds, ...styleMapKeys])].filter(id => typeof id === 'string' && id.includes('gid://'));

                const mandatoryFields = ['selectedTemplateCoupon', 'temp1DefaultStyle'];
                const hasMandatoryFields = mandatoryFields.every((field) => text.includes(field));

                if (!couponIds || !couponIds.length) {
                    if (isTruncated || !hasMandatoryFields) {
                        container.innerHTML = `
              <div style="color: #444; font-size: 13px; line-height: 1.5; padding: 15px; background: #fff4f4; border: 1px solid #ffcccc; border-radius: 6px; margin: 10px 0;">
                <strong style="color: #d32f2f;">🛠️ Repair Needed (Data Truncated)</strong><br>
                The server is cutting off your data. 1) Run the SQL command again. 2) <strong>Go to App Admin and click SAVE.</strong><br>
                <small style="opacity: 0.6;">Server Response: ${text.substring(0, 50)}...</small><br>
                <small style="opacity: 0.6;">Last Saved: ${lastSave}</small>
              </div>
            `;
                    } else {
                        container.innerHTML = 'No coupons configured.';
                    }
                    return;
                }

                const currentProductHandle = container.dataset.productHandle || '';
                const currentCollectionHandles = (container.dataset.collectionHandles || '').split(',').filter(Boolean);
                const currentCollectionHandle = container.dataset.currentCollection || '';

                const normalizedStyleMap = {};
                Object.keys(couponStyleMap || {}).forEach((key) => {
                    normalizedStyleMap[normalizeId(key)] = couponStyleMap[key];
                });

                const conditions = safeParse(data[`temp${selectedTemplate.charAt(selectedTemplate.length - 1)}CouponCondition`], true);

                const filteredCouponIds = couponIds.filter((cid) => {
                    const normCid = normalizeId(cid);
                    const condition = conditions.find((c) => normalizeId(c.couponId) === normCid);
                    if (!condition || !condition.displayCondition || condition.displayCondition === 'all') return true;
                    if (condition.displayCondition === 'product_handle') {
                        return condition.productHandles && condition.productHandles.includes(currentProductHandle);
                    }
                    if (condition.displayCondition === 'collection_handle') {
                        return (condition.collectionHandles || []).some(ch => currentCollectionHandles.includes(ch) || ch === currentCollectionHandle);
                    }
                    return true;
                });

                if (filteredCouponIds.length === 0) {
                    container.innerHTML = '';
                    return;
                }

                renderTemplate(container, selectedTemplate, defaultStyle, filteredCouponIds, normalizedStyleMap);
            })
            .catch((err) => {
                console.error('Coupon Slider Critical Error:', err);
                container.innerHTML = 'Error loading coupons.';
            });

        function renderTemplate(container, template, defaultStyle, couponIds, couponStyleMap) {
                        const titleCfg = (defaultStyle && typeof defaultStyle.title === 'object') ? defaultStyle.title : {};
                        const titleText = (titleCfg && titleCfg.text !== undefined) ? String(titleCfg.text) : 'Apply Coupon';
                        const titleFontSize = Number.isFinite(Number(titleCfg && titleCfg.fontSize)) ? Number(titleCfg.fontSize) : 14;
                        const titleColor = (titleCfg && titleCfg.textColor) ? String(titleCfg.textColor) : '#111827';
                        const titleAlignRaw = (titleCfg && titleCfg.alignment) ? String(titleCfg.alignment) : 'left';
                        const titleAlign = ['left', 'center', 'right'].includes(titleAlignRaw) ? titleAlignRaw : 'left';

            container.innerHTML = `
        <div class="ps-list-container">
                    <div class="ps-section-title" style="text-align:${titleAlign};color:${titleColor};font-size:${titleFontSize}px;font-weight:700;margin-bottom:10px;line-height:1.2;">${titleText}</div>
          <div class="ps-nav-group">
            <button class="ps-nav-btn prev" onclick="psScroll(-1)" aria-label="Previous">&#8249;</button>
            <button class="ps-nav-btn next" onclick="psScroll(1)" aria-label="Next">&#8250;</button>
          </div>
          <div class="ps-coupon-list" id="psCouponList"></div>
        </div>
      `;

            const listArea = container.querySelector('#psCouponList');
            const navGroup = container.querySelector('.ps-nav-group');

            if (couponIds.length <= 1) {
                if (navGroup) navGroup.style.display = 'none';
            } else {
                if (navGroup) navGroup.style.display = 'flex';
            }

            function buildCard(couponId) {
                const override = (couponStyleMap && couponStyleMap[normalizeId(couponId)]) || {};
                const finalStyle = { ...defaultStyle, ...override };
                const heading = finalStyle.headingText || 'Special Offer';
                const subtext = finalStyle.subtextText || '';
                const code = couponId.split('/').pop();
                let card = document.createElement('div');

                if (template === 'template1') {
                    card.className = 'ps-template1';
                    card.innerHTML = `<div class="ps-t1-content"><div class="ps-t1-text"><h2>${heading}</h2><p>${subtext}</p></div><button class="ps-btn" data-code="${code}">Copy Code</button></div>`;
                    card.style.background = finalStyle.bgColor;
                    card.style.borderLeft = `5px solid ${finalStyle.accentColor}`;
                    card.style.borderRadius = finalStyle.borderRadius + 'px';
                    card.style.padding = (finalStyle.padding || 12) + 'px ' + ((finalStyle.padding || 12) + 4) + 'px';
                } else if (template === 'template2') {
                    card.className = 'ps-template2';
                    card.innerHTML = `<div class="ps-notch left"></div><div class="ps-notch right"></div><div class="ps-t2-left"><span class="ps-label">Your Code</span><span class="ps-code">${code}</span><div class="ps-line"></div></div><div class="ps-divider"></div><div class="ps-t2-right"><h2>${heading}</h2><p>${subtext}</p><button class="ps-btn" data-code="${code}">Redeem Now</button></div>`;
                    card.style.background = finalStyle.bgColor;
                    card.style.borderRadius = finalStyle.borderRadius + 'px';
                } else if (template === 'template3') {
                    card.className = 'ps-template3';
                    card.innerHTML = `<div class="ps-icon">🏷️</div><div class="ps-text"><h3>${heading}</h3><p>${subtext}</p></div><div class="ps-code-pill">${code}</div><button class="ps-btn" data-code="${code}">Apply</button>`;
                    card.style.background = finalStyle.bgColor;
                    card.style.borderRadius = finalStyle.borderRadius + 'px';
                    card.style.border = `1px solid ${finalStyle.accentColor}22`;
                    card.style.padding = '12px 16px';
                } else if (template === 'template4') {
                    card.className = 'ps-template4';
                    card.innerHTML = `<div class="ps-t4-top"><div class="ps-t4-icon">🏷️</div><div class="ps-t4-info"><h3>${heading}</h3><p>${subtext}</p></div></div><div class="ps-t4-action"><div class="ps-t4-code">${code}</div><button class="ps-btn ps-t4-btn" data-code="${code}">Apply</button></div>`;
                    card.style.background = finalStyle.bgColor;
                    card.style.borderRadius = finalStyle.borderRadius + 'px';
                    card.style.color = finalStyle.textColor;
                }
                return card;
            }

            couponIds.forEach((id) => {
                const card = buildCard(id);
                if (card && listArea) listArea.appendChild(card);
            });

            container.addEventListener('click', function (e) {
                if (e.target.classList.contains('ps-btn')) {
                    const code = e.target.dataset.code;
                    navigator.clipboard.writeText(code);
                    const originalText = e.target.innerText;
                    e.target.innerText = 'Copied!';
                    setTimeout(() => { e.target.innerText = originalText; }, 2000);
                }
            });
        }
    });

    window.psScroll = function (direction) {
        const list = document.getElementById('psCouponList');
        if (!list) return;
        const firstCard = list.querySelector('.ps-template1, .ps-template2, .ps-template3, .ps-template4');
        const cardWidth = firstCard ? firstCard.offsetWidth : 320;
        const scrollAmount = cardWidth + 15;
        list.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    };
})();
