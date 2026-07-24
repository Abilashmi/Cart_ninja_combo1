// Serves the vanilla-JS combo-page renderer as a real .js asset. Published
// combo pages (app/routes/api.bundle-templates.jsx's PAGE_BODY) load this
// via a plain <script src="..."> tag — Shopify Pages don't process Liquid in
// their body content, so this can't be a theme-extension asset; it has to be
// served directly from this app instead (see conversation: verified live on
// fpzz1i-ds.myshopify.com that {{ 'x' | asset_url }} renders as literal text
// inside a Page body).
//
// MVP scope: one flat product grid (regardless of which layout the combo was
// built with — layout1/2/4 all resolve to *some* set of collection handles;
// this renders all of their products in one grid rather than replicating
// each layout's distinct step/tab/editorial UI). Variant selection, quantity,
// and checkout-with-discount are fully wired. Layout-specific visuals are a
// deliberate fast-follow, not shipped here.
const SCRIPT_BODY = String.raw`
(function () {
  var CURRENT_SCRIPT = document.currentScript;
  var API_ORIGIN = CURRENT_SCRIPT ? new URL(CURRENT_SCRIPT.src).origin : '';

  var CURRENCY_SYMBOLS = {
    USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AUD: 'A$', CAD: 'C$',
    CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$', MXN: '$', SGD: 'S$', HKD: 'HK$',
    NOK: 'kr', KRW: '₩', TRY: '₺', RUB: '₽', BRL: 'R$', ZAR: 'R', THB: '฿',
  };
  function currencySymbol(code) { return CURRENCY_SYMBOLS[code] || code || '$'; }

function fetchAndRender(root, shop, query) {
    root.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">Loading…</div>';

    return fetch(API_ORIGIN + '/api/combo-page-data?shop=' + encodeURIComponent(shop) + '&' + query)
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (!json.success) {
          root.innerHTML = '<div style="padding:40px;text-align:center;color:#c00;">This combo is unavailable.</div>';
          return false;
        }
        render(root, json.data, shop);
        return true;
      })
      .catch(function () {
        root.innerHTML = '<div style="padding:40px;text-align:center;color:#c00;">Failed to load this combo.</div>';
        return false;
      });
  }

  // Explicit mount point — used when a page's own body/template already
  // knows which combo template it is (the guaranteed-template path, pending
  // Shopify's themeFilesUpsert exemption; see api.bundle-templates.jsx).
  function init(root) {
    var shop = root.dataset.shop;
    var templateId = root.dataset.templateId;
    if (!shop || !templateId) return;
    fetchAndRender(root, shop, 'templateId=' + encodeURIComponent(templateId));
  }

  function render(root, data, shop) {
    var config = data.config || {};
    var productsByHandle = data.productsByHandle || {};
    var activeDiscounts = data.activeDiscounts || [];
    var maxProducts = parseInt(config.max_products, 10) || 5;

    // Flatten + dedupe across every collection this template resolved,
    // regardless of which layout (step/tab/editorial) it was built with.
    var seen = {};
    var products = [];
    Object.keys(productsByHandle).forEach(function (handle) {
      (productsByHandle[handle] || []).forEach(function (p) {
        if (seen[p.id]) return;
        seen[p.id] = true;
        products.push(p);
      });
    });

    if (products.length === 0) {
      root.innerHTML = '<div style="padding:40px;text-align:center;color:#888;">No products in this combo yet.</div>';
      return;
    }

    var symbol = currencySymbol(products[0] && products[0].currency);
    var selected = {}; // variantId -> { qty, product, variant }

    var desktopCols = parseInt(config.desktop_columns, 10) || 3;
    var mobileCols = parseInt(config.mobile_columns, 10) || 2;
    var gap = config.products_gap != null ? config.products_gap : 12;
    var addBtnBg = config.product_add_btn_color || '#111827';
    var addBtnText = config.product_add_btn_text_color || '#ffffff';
    var addBtnLabel = config.product_add_btn_text || 'Add';

    root.innerHTML =
      '<style>' +
      '.brix-combo-grid{display:grid;grid-template-columns:repeat(' + mobileCols + ',1fr);gap:' + gap + 'px;padding:16px;box-sizing:border-box;}' +
      '@media (min-width:700px){.brix-combo-grid{grid-template-columns:repeat(' + desktopCols + ',1fr);}}' +
      '.brix-combo-card{border:2px solid #eee;border-radius:12px;overflow:hidden;background:#fff;display:flex;flex-direction:column;transition:border-color .2s;}' +
      '.brix-combo-card.is-added{border-color:#22c55e;}' +
      '.brix-combo-card img{width:100%;height:180px;object-fit:contain;background:#f5f5f5;display:block;}' +
      '.brix-combo-body{padding:10px;display:flex;flex-direction:column;gap:6px;}' +
      '.brix-combo-title{font-size:13px;font-weight:500;line-height:1.3;min-height:2.6em;overflow:hidden;}' +
      '.brix-combo-select{font-size:12px;padding:5px 6px;border:1px solid #ddd;border-radius:6px;}' +
      '.brix-combo-price{font-size:14px;font-weight:700;}' +
      '.brix-combo-qty{display:flex;align-items:center;gap:8px;}' +
      '.brix-combo-qty button{width:28px;height:28px;border:1px solid #ddd;background:#f9f9f9;border-radius:6px;cursor:pointer;font-size:16px;}' +
      '.brix-combo-addbtn{padding:8px;border:none;border-radius:8px;cursor:pointer;font-weight:600;background:' + addBtnBg + ';color:' + addBtnText + ';}' +
      '.brix-combo-bar{position:sticky;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;}' +
      '.brix-combo-checkout{padding:10px 20px;border:none;border-radius:8px;background:#111827;color:#fff;font-weight:600;cursor:pointer;}' +
      '.brix-combo-checkout:disabled{opacity:.4;cursor:not-allowed;}' +
      '</style>' +
      '<div class="brix-combo-grid" id="brix-combo-grid"></div>' +
      '<div class="brix-combo-bar">' +
        '<div id="brix-combo-summary" style="font-size:14px;">Select products to build your combo</div>' +
        '<button class="brix-combo-checkout" id="brix-combo-checkout" disabled>Checkout</button>' +
      '</div>';

    var grid = root.querySelector('#brix-combo-grid');
    var summary = root.querySelector('#brix-combo-summary');
    var checkoutBtn = root.querySelector('#brix-combo-checkout');

    products.forEach(function (product) {
      grid.appendChild(buildCard(product));
    });

    function buildCard(product) {
      var variants = product.variants || [];
      var hasVariants = variants.length > 1;
      var activeVariantId = (variants[0] && variants[0].id) || product.variantId;

      var card = document.createElement('div');
      card.className = 'brix-combo-card';

      var img = document.createElement('img');
      img.src = (product.image && product.image.url) || '';
      img.alt = (product.image && product.image.altText) || product.title;
      card.appendChild(img);

      var body = document.createElement('div');
      body.className = 'brix-combo-body';

      var title = document.createElement('div');
      title.className = 'brix-combo-title';
      title.textContent = product.title;
      body.appendChild(title);

      var select = null;
      if (hasVariants) {
        select = document.createElement('select');
        select.className = 'brix-combo-select';
        variants.forEach(function (v) {
          var opt = document.createElement('option');
          opt.value = v.id;
          opt.textContent = v.title;
          select.appendChild(opt);
        });
        select.addEventListener('change', function () {
          activeVariantId = select.value;
          updatePrice();
        });
        body.appendChild(select);
      }

      var price = document.createElement('div');
      price.className = 'brix-combo-price';
      body.appendChild(price);

      var qtyRow = document.createElement('div');
      qtyRow.className = 'brix-combo-qty';
      body.appendChild(qtyRow);

      var addBtn = document.createElement('button');
      addBtn.className = 'brix-combo-addbtn';
      addBtn.textContent = addBtnLabel;
      addBtn.addEventListener('click', function () {
        addToSelection(product, activeVariantId, variants);
        renderQty();
      });
      body.appendChild(addBtn);

      card.appendChild(body);

      function activeVariant() {
        return variants.filter(function (v) { return String(v.id) === String(activeVariantId); })[0];
      }

      function updatePrice() {
        var v = activeVariant();
        var amount = v ? parseFloat(v.price) : parseFloat(product.price || 0);
        price.textContent = symbol + amount.toFixed(2);
      }

      function renderQty() {
        var sel = selected[activeVariantId];
        card.classList.toggle('is-added', !!sel);
        addBtn.style.display = sel ? 'none' : '';
        qtyRow.innerHTML = '';
        if (!sel) return;
        var dec = document.createElement('button');
        dec.textContent = '−';
        dec.addEventListener('click', function () {
          if (sel.qty <= 1) { removeFromSelection(activeVariantId); }
          else { sel.qty -= 1; }
          renderQty(); updateSummary();
        });
        var qtyLabel = document.createElement('span');
        qtyLabel.textContent = sel.qty;
        var inc = document.createElement('button');
        inc.textContent = '+';
        inc.addEventListener('click', function () {
          addToSelection(product, activeVariantId, variants, true);
          renderQty(); updateSummary();
        });
        qtyRow.appendChild(dec);
        qtyRow.appendChild(qtyLabel);
        qtyRow.appendChild(inc);
      }

      updatePrice();
      renderQty();

      card._renderQty = renderQty;
      return card;
    }

    function totalSelectedQty() {
      return Object.keys(selected).reduce(function (sum, id) { return sum + selected[id].qty; }, 0);
    }

    function addToSelection(product, variantId, variants, isIncrement) {
      var v = variants.filter(function (x) { return String(x.id) === String(variantId); })[0];
      if (selected[variantId]) {
        if (totalSelectedQty() >= maxProducts) return;
        selected[variantId].qty += 1;
      } else {
        if (totalSelectedQty() >= maxProducts) return;
        selected[variantId] = { qty: 1, product: product, variant: v };
      }
      updateSummary();
    }

    function removeFromSelection(variantId) {
      delete selected[variantId];
      updateSummary();
    }

    function computeTotals() {
      var totalPrice = 0;
      Object.keys(selected).forEach(function (id) {
        var sel = selected[id];
        var amount = sel.variant ? parseFloat(sel.variant.price) : parseFloat(sel.product.price || 0);
        totalPrice += amount * sel.qty;
      });

      var selectedDiscount = null;
      if (config.has_discount_offer && config.selected_discount_id) {
        selectedDiscount = activeDiscounts.filter(function (d) { return String(d.id) === String(config.selected_discount_id); })[0] || null;
      }
      var discountType = (selectedDiscount && selectedDiscount.valueType) || config.discount_selection || '';
      var discountVal = selectedDiscount && selectedDiscount.value
        ? parseFloat(selectedDiscount.value)
        : (parseFloat(config.discount_amount) || 0);
      var hasDiscount = !!discountType && discountVal > 0;
      var threshold = parseInt(config.discount_threshold, 10) || maxProducts;
      var isDiscountUnlocked = totalSelectedQty() >= threshold;
      var discountApplicable = hasDiscount && isDiscountUnlocked;
      var finalPrice = totalPrice;
      if (discountApplicable) {
        finalPrice = String(discountType).toLowerCase() === 'percentage'
          ? totalPrice * (1 - discountVal / 100)
          : Math.max(0, totalPrice - discountVal);
      }
      return { totalPrice: totalPrice, finalPrice: finalPrice, discountApplicable: discountApplicable, selectedDiscount: selectedDiscount };
    }

    function updateSummary() {
      var totals = computeTotals();
      var qty = totalSelectedQty();
      if (qty === 0) {
        summary.textContent = 'Select products to build your combo';
        checkoutBtn.disabled = true;
        return;
      }
      checkoutBtn.disabled = false;
      if (totals.discountApplicable) {
        summary.innerHTML = qty + ' item' + (qty === 1 ? '' : 's') +
          ' — <span style="text-decoration:line-through;color:#999;">' + symbol + totals.totalPrice.toFixed(2) + '</span> ' +
          '<strong>' + symbol + totals.finalPrice.toFixed(2) + '</strong>';
      } else {
        summary.textContent = qty + ' item' + (qty === 1 ? '' : 's') + ' — ' + symbol + totals.totalPrice.toFixed(2);
      }
    }

    checkoutBtn.addEventListener('click', function () {
      if (totalSelectedQty() === 0) return;
      var totals = computeTotals();
      var cartLines = Object.keys(selected).map(function (variantId) {
        var shortId = String(variantId).split('/').pop();
        return shortId + ':' + selected[variantId].qty;
      });
      var params = new URLSearchParams();
      params.set('attributes[combo_source]', 'ComboForge');
      params.set('attributes[combo_template_id]', String(data.templateId));
      params.set('attributes[combo_template_name]', data.templateName || '');
      var cartPath = '/cart/' + cartLines.join(',') + '?' + params.toString();
      var destination = (totals.discountApplicable && totals.selectedDiscount && totals.selectedDiscount.code)
        ? 'https://' + shop + '/discount/' + encodeURIComponent(totals.selectedDiscount.code) + '?redirect=' + encodeURIComponent(cartPath)
        : 'https://' + shop + cartPath;
      window.location.href = destination;
    });
  }

  // Auto-detect mode — runs on every page via the cart-drawer app embed
  // (already loaded globally on every page for merchants who've enabled it),
  // since that embed has no way to know in advance which pages are combo
  // pages. Cheap early-outs: only even attempts a lookup on /pages/* URLs,
  // and skips entirely if an explicit [data-brix-combo-root] already exists
  // (the guaranteed-template path, once Shopify's exemption lands, takes
  // priority and this would otherwise double-render).
  function autoDetectAndInject() {
    if (document.querySelector('[data-brix-combo-root]')) return;

    var match = window.location.pathname.match(/\/pages\/([^/?#]+)/);
    if (!match) return;
    var handle = match[1];

    var shop = (window.Shopify && window.Shopify.shop) || window.location.hostname;

    var main = document.querySelector('main#MainContent') || document.querySelector('main[role="main"]') || document.querySelector('main');
    var container = main || document.body;

    var root = document.createElement('div');
    root.setAttribute('data-brix-combo-root', '');
    root.style.display = 'none'; // hidden until we confirm this handle is actually a combo page
    container.appendChild(root);

    fetchAndRender(root, shop, 'handle=' + encodeURIComponent(handle)).then(function (matched) {
      if (matched) {
        root.style.display = '';
      } else {
        root.remove(); // not a combo page — leave the theme's own content untouched
      }
    });
  }

  function boot() {
    var roots = document.querySelectorAll('[data-brix-combo-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
    autoDetectAndInject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export async function loader() {
  return new Response(SCRIPT_BODY, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
