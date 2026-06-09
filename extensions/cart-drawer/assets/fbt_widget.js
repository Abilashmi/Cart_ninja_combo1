  (function () {
    const container = document.getElementById('ps-fbt-{{ block.id }}');
    const shop = container.dataset.shop;
    const currencyCode = container.dataset.currency || 'USD';
    const productId = 'gid://shopify/Product/' + container.dataset.productId;

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

    const currencySymbol = getCurrencySymbol(currencyCode);

    const API_URL = '/apps/cart-app/save_fbt_widget.php?shopdomain=' + encodeURIComponent(shop);

    fetch(API_URL, { headers: { 'ngrok-skip-browser-warning': 'true' } })
      .then((r) => r.json())
      .then((response) => {
        console.log('[FBT] raw response:', response);

        if (!response || response.status !== 'success') {
          console.warn('[FBT] no success status, aborting');
          return;
        }

        const data = response.data;
        console.log('[FBT] data keys:', Object.keys(data));
        const selectedTemplate = data.selectedTemp || data.selectedTemplate || data.activeTemplate || 'fbt1';
        console.log('[FBT] selectedTemp:', selectedTemplate);
        console.log('[FBT] condition:', data.condition);
        console.log('[FBT] current productId:', productId);

        const templateMap = {
          fbt1: data.temp1 || (data.templates && data.templates.fbt1),
          fbt2: data.temp2 || (data.templates && data.templates.fbt2),
          fbt3: data.temp3 || (data.templates && data.templates.fbt3),
        };

        const config = normalizeConfig(templateMap[selectedTemplate]);
        if (!config) {
          console.warn('[FBT] no config for template:', selectedTemplate, 'â€” available:', Object.keys(templateMap));
          return;
        }

        const rules = normalizeRules(
          data.condition ||
          data.manualRules ||
          data.manualConfiguration ||
          []
        );
        console.log('[FBT] rules count:', rules.length);

        // -----------------------------
        // MULTI-RULE AGGREGATION
        // -----------------------------
        let matchedProducts = [];

        rules.forEach((rule, i) => {
          const triggerCandidates = (rule.triggerProducts || []).length
            ? (rule.triggerProducts || [])
            : (rule.triggerProductId ? [{ id: rule.triggerProductId }] : []);

          console.log(`[FBT] rule[${i}] scope:`, rule.displayScope, 'triggers:', triggerCandidates.map(p => p.id));

          if (rule.displayScope === 'all') {
            matchedProducts = matchedProducts.concat(rule.fbtProducts);
          }

          if (rule.displayScope === 'single' || rule.displayScope === 'per_product') {
            const match = triggerCandidates.some((p) => p.id === productId);
            console.log(`[FBT] rule[${i}] match:`, match);
            if (match) {
              matchedProducts = matchedProducts.concat(rule.fbtProducts);
            }
          }
        });

        if (!matchedProducts.length) {
          console.warn('[FBT] no matched products for productId:', productId);
          return;
        }

        matchedProducts = dedupe(matchedProducts);

        renderFBT(container, config, matchedProducts);
      });

    function dedupe(products) {
      const map = new Map();
      products.forEach((p) => map.set(p.id, p));
      return Array.from(map.values());
    }

    function normalizeRules(source) {
      let parsed = source;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          parsed = [];
        }
      }

      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((rule) => rule && typeof rule === 'object')
        .map((rule, index) => ({
          id: rule.id || rule.ruleId || `rule-${index}`,
          displayScope: rule.displayScope || 'all',
          triggerProducts: Array.isArray(rule.triggerProducts) ? rule.triggerProducts : [],
          triggerProductId: rule.triggerProductId || null,
          fbtProducts: Array.isArray(rule.fbtProducts) ? rule.fbtProducts : [],
        }))
        .filter((rule) => rule.fbtProducts.length > 0);
    }

    function normalizeConfig(config) {
      if (!config || typeof config !== 'object') return null;

      const borderRadius = Number(config.borderRadius);
      return {
        layout: config.layout || 'horizontal',
        interactionType: config.interactionType || 'classic',
        bgColor: config.bgColor || '#ffffff',
        textColor: config.textColor || '#111827',
        priceColor: config.priceColor || '#059669',
        buttonColor: config.buttonColor || '#111827',
        buttonTextColor: config.buttonTextColor || config.buttonText || '#ffffff',
        borderColor: config.borderColor || '#e5e7eb',
        borderRadius: Number.isFinite(borderRadius) ? borderRadius : 8,
        showPrices: config.showPrices !== false,
        showAddAllButton: config.showAddAllButton !== false,
      };
    }

    function toPriceNumber(value) {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function extractNumericId(value) {
      const source = String(value || '');
      const match = source.match(/(\d+)(?!.*\d)/);
      return match ? match[1] : '';
    }

    function normalizeVariantId(value) {
      const normalized = extractNumericId(value);
      return normalized || '';
    }

    async function buildVariantLookup(products) {
      const variantByProductId = new Map();

      (products || []).forEach((product) => {
        const explicitVariant = normalizeVariantId(
          product?.variantId || product?.variant_id || product?.variant?.id
        );

        const idFromGid = String(product?.id || '').includes('ProductVariant')
          ? normalizeVariantId(product?.id)
          : '';

        const variantId = explicitVariant || idFromGid;
        if (variantId) {
          variantByProductId.set(String(product.id), variantId);
        }
      });

      let unresolved = (products || []).filter((product) => !variantByProductId.has(String(product.id)));

      if (unresolved.length) {
        try {
          const productsRes = await fetch('/products.json?limit=250');
          if (productsRes.ok) {
            const productsJson = await productsRes.json();
            const ajaxProducts = Array.isArray(productsJson?.products) ? productsJson.products : [];

            const firstVariantByProductNumericId = new Map();
            ajaxProducts.forEach((ajaxProduct) => {
              const productId = String(ajaxProduct?.id || '');
              const variants = Array.isArray(ajaxProduct?.variants) ? ajaxProduct.variants : [];
              const firstAvailableVariant = variants.find((variant) => variant?.available) || variants[0];
              const firstVariantId = normalizeVariantId(firstAvailableVariant?.id);
              if (productId && firstVariantId) {
                firstVariantByProductNumericId.set(productId, firstVariantId);
              }
            });

            unresolved.forEach((product) => {
              const numericProductId = extractNumericId(product?.id);
              const resolvedVariantId = firstVariantByProductNumericId.get(numericProductId);
              if (resolvedVariantId) {
                variantByProductId.set(String(product.id), resolvedVariantId);
              }
            });
          }
        } catch (error) {
          console.warn('[FBT] /products.json lookup failed:', error);
        }
      }

      unresolved = (products || []).filter((product) => !variantByProductId.has(String(product.id)));
      for (const product of unresolved) {
        const handle = String(product?.handle || '').trim();
        if (!handle) continue;

        try {
          const handleRes = await fetch('/products/' + encodeURIComponent(handle) + '.js');
          if (!handleRes.ok) continue;

          const handleJson = await handleRes.json();
          const variants = Array.isArray(handleJson?.variants) ? handleJson.variants : [];
          const firstAvailableVariant = variants.find((variant) => variant?.available) || variants[0];
          const resolvedVariantId = normalizeVariantId(firstAvailableVariant?.id);
          if (resolvedVariantId) {
            variantByProductId.set(String(product.id), resolvedVariantId);
          }
        } catch (error) {
          console.warn('[FBT] handle lookup failed for', handle, error);
        }
      }

      return variantByProductId;
    }

    function notifyCartUpdated(detail) {
      [
        'cart:item-added',
        'cart:updated',
        'cart:add',
        'cart:refresh',
        'on:cart:add',
        'shopify:cart:added',
        'theme:cart:open',
        'cart:open',
      ].forEach((eventName) => {
        try {
          document.dispatchEvent(new CustomEvent(eventName, { detail }));
          window.dispatchEvent(new CustomEvent(eventName, { detail }));
        } catch {}
      });
    }

    async function getCartAddErrorMessage(response) {
      const fallback = 'Failed to add selected products to cart.';

      try {
        const body = await response.clone().json();
        return body?.description || body?.message || fallback;
      } catch {}

      try {
        const text = await response.text();
        return text || fallback;
      } catch {}

      return fallback;
    }

    async function postCartAdd(items) {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        const message = await getCartAddErrorMessage(response);
        throw new Error(message);
      }

      return response;
    }

    async function addItemsWithFallback(items) {
      try {
        await postCartAdd(items);
        return { addedItems: items, failedItems: [] };
      } catch (batchError) {
        const settled = await Promise.all(
          items.map(async (item) => {
            try {
              await postCartAdd([{ id: item.id, quantity: item.quantity }]);
              return { ok: true, item };
            } catch (itemError) {
              return {
                ok: false,
                item,
                error: itemError?.message || batchError?.message || 'Failed to add item.',
              };
            }
          })
        );

        const addedItems = settled
          .filter((entry) => entry.ok)
          .map((entry) => entry.item);

        const failedItems = settled
          .filter((entry) => !entry.ok)
          .map((entry) => ({
            ...entry.item,
            error: entry.error,
          }));

        return { addedItems, failedItems };
      }
    }

    function renderFBT(container, config, products) {
      container.innerHTML = `
      <div class="ps-fbt-wrapper"
           style="
             background:${config.bgColor};
             border-radius:${config.borderRadius}px;
             border:1px solid ${config.borderColor};
           ">
        <div class="ps-fbt-title" style="color:${config.textColor}">
          Frequently Bought Together
        </div>

        <div class="ps-fbt-products ${config.layout}"></div>

        <div class="ps-fbt-footer"
             style="border-color:${config.borderColor}">
          <div>
            <div style="font-size:13px;opacity:.6;color:${config.textColor}">
              Total
            </div>
            <div class="ps-total-price"
                 style="font-size:22px;font-weight:900;color:${config.priceColor}">
              ${currencySymbol}0
            </div>
          </div>

          ${
            config.showAddAllButton
              ? `
            <button class="ps-fbt-addall"
              style="background:${config.buttonColor};color:${config.buttonTextColor}">
              Add to Cart
            </button>`
              : ''
          }
        </div>
      </div>
    `;

      const wrapper = container.querySelector('.ps-fbt-products');
      const totalEl = container.querySelector('.ps-total-price');
      const addBtn = container.querySelector('.ps-fbt-addall');

      let selected = new Map();

      // -----------------------------
      // DEFAULT SELECTION FOR BUNDLE
      // -----------------------------
      if (config.interactionType === 'bundle') {
        products.forEach((p) => selected.set(p.id, 1));
      }

      products.forEach((p, index) => {
        const card = document.createElement('div');
        card.className = `ps-product-card ${config.layout}`;
        card.style.borderColor = config.borderColor;
        card.style.borderRadius = config.borderRadius + 'px';
        card.style.color = config.textColor;

        const safeTitle = escapeHtml(p.title || 'Product');
        const imageUrl = String(p.image || '').replace(/'/g, '%27');
        const price = toPriceNumber(p.price);

        card.innerHTML = `
        <div class="ps-product-main">
          <div class="ps-product-image"
               style="${imageUrl ? `background-image:url('${imageUrl}')` : ''}">
            ${imageUrl ? '' : '<span>No image</span>'}
          </div>

          <div class="ps-product-meta">
            <div class="ps-product-title">${safeTitle}</div>
            ${
              config.showPrices
                ? `
            <div class="ps-product-price" style="color:${config.priceColor}">
              ${currencySymbol}${Number(price).toLocaleString()}
            </div>`
                : ''
            }
          </div>
        </div>

        <div class="ps-product-action"></div>
      `;

        const actionSlot = card.querySelector('.ps-product-action');

        // -------- CLASSIC --------
        if (config.interactionType === 'classic') {
          const btn = document.createElement('button');
          btn.className = 'ps-classic-btn';
          btn.style.border = `1px solid ${config.buttonColor}`;
          btn.style.color = config.buttonColor;
          btn.textContent = 'Add';

          btn.onclick = () => {
            if (selected.has(p.id)) {
              selected.delete(p.id);
              btn.textContent = 'Add';
              btn.style.background = 'transparent';
              btn.style.color = config.buttonColor;
            } else {
              selected.set(p.id, 1);
              btn.textContent = 'Added';
              btn.style.background = config.buttonColor;
              btn.style.color = config.buttonTextColor;
            }
            updateTotal();
          };

          if (actionSlot) actionSlot.appendChild(btn);
        }

        // -------- QUICK ADD --------
        if (config.interactionType === 'quickAdd') {
          selected.set(p.id, 0);

          const stepper = document.createElement('div');
          stepper.className = 'ps-stepper';
          stepper.style.border = `1px solid ${config.buttonColor}`;

          stepper.innerHTML = `
          <button style="background:${config.buttonColor};color:${config.buttonTextColor}">âˆ’</button>
          <span>0</span>
          <button style="background:${config.buttonColor};color:${config.buttonTextColor}">+</button>
        `;

          const minus = stepper.children[0];
          const qty = stepper.children[1];
          const plus = stepper.children[2];

          minus.onclick = () => {
            let val = selected.get(p.id);
            if (val > 0) {
              val--;
              selected.set(p.id, val);
              qty.textContent = val;
              updateTotal();
            }
          };

          plus.onclick = () => {
            let val = selected.get(p.id);
            val++;
            selected.set(p.id, val);
            qty.textContent = val;
            updateTotal();
          };

          if (actionSlot) actionSlot.appendChild(stepper);
        }

        // -------- BUNDLE --------
        if (config.interactionType === 'bundle') {
          const check = document.createElement('button');
          check.type = 'button';
          check.className = 'ps-bundle-check';
          check.style.borderColor = config.buttonColor;
          check.style.color = config.buttonColor;
          check.style.background = '#fff';
          check.style.opacity = '1';
          check.style.transition = 'none';

          const setBundleCheckState = (isSelected) => {
            if (isSelected) {
              check.classList.add('active');
              check.style.background = config.buttonColor;
              check.style.color = config.buttonTextColor || '#fff';
              check.textContent = 'âœ“';
            } else {
              check.classList.remove('active');
              check.style.background = '#fff';
              check.style.color = config.buttonColor;
              check.textContent = '';
            }

            // Keep fully visible in both selected and unselected states.
            check.style.opacity = '1';
            card.style.opacity = '1';
          };

          setBundleCheckState(selected.has(p.id));

          check.onclick = () => {
            if (selected.size <= 1 && selected.has(p.id)) return; // min 1 required

            if (selected.has(p.id)) {
              selected.delete(p.id);
              setBundleCheckState(false);
            } else {
              selected.set(p.id, 1);
              setBundleCheckState(true);
            }
            updateTotal();
          };

          if (index === 0) {
            const badge = document.createElement('div');
            badge.className = 'ps-required';
            badge.textContent = 'REQUIRED';
            badge.style.background = config.buttonColor;
            badge.style.color = config.buttonTextColor;
            card.appendChild(badge);
          }

          if (actionSlot) actionSlot.appendChild(check);
        }

        wrapper.appendChild(card);
      });

      function updateTotal() {
        let total = 0;
        products.forEach((p) => {
          const qty = selected.get(p.id) || 0;
          total += qty * toPriceNumber(p.price);
        });
        totalEl.textContent = currencySymbol + Number(total).toLocaleString();
      }

      updateTotal();

      if (addBtn) {
        addBtn.onclick = async () => {
          const defaultLabel = 'Add to Cart';
          addBtn.disabled = true;
          addBtn.textContent = 'Adding...';

          try {
            const variantLookup = await buildVariantLookup(products);
            const items = [];
            const productById = new Map((products || []).map((product) => [String(product.id), product]));

            selected.forEach((qty, id) => {
              if (qty <= 0) return;
              const variantId = variantLookup.get(String(id));
              if (!variantId) return;

              const product = productById.get(String(id));

              items.push({
                id: String(variantId),
                quantity: qty,
                productId: String(id),
                productTitle: product?.title || 'Product',
              });
            });

            if (!items.length) {
              throw new Error('Unable to resolve variant IDs for selected products. Please re-save your FBT rule and try again.');
            }

            const { addedItems, failedItems } = await addItemsWithFallback(items);

            if (!addedItems.length) {
              const failedTitles = failedItems
                .map((item) => item.productTitle)
                .filter(Boolean)
                .slice(0, 3)
                .join(', ');
              const moreLabel = failedItems.length > 3 ? ', and more' : '';
              const detail = failedTitles
                ? `None of the selected products are currently available: ${failedTitles}${moreLabel}.`
                : (failedItems[0]?.error || 'Failed to add selected products to cart.');
              throw new Error(detail);
            }

            let cart = null;
            try {
              const cartRes = await fetch('/cart.js');
              if (cartRes.ok) {
                cart = await cartRes.json();
              }
            } catch {}

            notifyCartUpdated({
              source: 'fbt',
              items: addedItems,
              cart,
            });

            const totalAddedQty = addedItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            addBtn.textContent = totalAddedQty > 1 ? `Added ${totalAddedQty}` : 'Added âœ“';

            if (failedItems.length > 0) {
              const failedTitles = failedItems
                .map((item) => item.productTitle)
                .filter(Boolean)
                .slice(0, 3)
                .join(', ');
              const moreLabel = failedItems.length > 3 ? ', and more' : '';
              alert(`${totalAddedQty} item(s) added. ${failedItems.length} item(s) could not be added: ${failedTitles}${moreLabel}.`);
            }

            setTimeout(() => {
              addBtn.textContent = defaultLabel;
            }, 1200);
          } catch (error) {
            console.error('[FBT] add to cart failed:', error);
            alert(error?.message || 'Failed to add selected products to cart.');
            addBtn.textContent = defaultLabel;
          } finally {
            addBtn.disabled = false;
          }
        };
      }
    }
  })();
