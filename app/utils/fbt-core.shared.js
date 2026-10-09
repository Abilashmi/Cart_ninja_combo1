/**
 * Frequently Bought Together (v2) — the one copy of the rules.
 *
 * Everything lives inside createFbtCore(), which has no imports and uses only
 * ES5 syntax, so exactly the same code runs in:
 *   - the storefront widget (extensions/cart-drawer/assets/brix_fbt.js, built
 *     by scripts/build-fbt-asset.mjs from this file + app/storefront/fbt-runtime.js),
 *   - the admin's live preview (app/routes/app.fbt.jsx) and the tests.
 * Don't add imports, closures over outside variables, or newer syntax inside
 * the factory: its source text is shipped to browsers as-is.
 *
 * Config (fbt_widget.config_v2, JSON):
 *   { version: 2, title, style: 'bundle' | 'cards', maxItems, showCurrent,
 *     preselect, cardsAddAll, theme: { bg, text, price, button, buttonText, border, radius },
 *     sources: { orders, carts, ai, shopify },
 *     rules: [{ id, name, enabled,
 *               when: { type: 'all' | 'products' | 'collections', products: [ref], collections: [ref] },
 *               show: { type: 'products' | 'collection', products: [ref], collection: ref | null } }],
 *     pairs: { "<product id>": [{ id, handle, source }] }, pairsUpdatedAt }
 *   ref = { id (numeric string), handle, title, image? }
 */
export function createFbtCore() {
  var STYLES = ['bundle', 'cards'];
  var WHEN_TYPES = ['all', 'products', 'collections'];
  var SHOW_TYPES = ['products', 'collection'];
  var SOURCES = ['orders', 'carts', 'ai', 'shopify'];
  var PLACEMENTS = ['below_cart', 'above_cart', 'custom'];
  var HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  var LIMITS = { rules: 50, refs: 30, title: 80, name: 60, maxItems: 6, pairsPerProduct: 6 };

  var DEFAULT_THEME = { bg: '#ffffff', text: '#111827', price: '#111827', button: '#111827', buttonText: '#ffffff', border: '#e5e7eb', radius: 12 };

  function defaults() {
    return {
      version: 2,
      title: 'Frequently bought together',
      style: 'bundle',
      placement: 'below_cart',
      maxItems: 3,
      showCurrent: true,
      preselect: true,
      cardsAddAll: true,
      theme: copy(DEFAULT_THEME),
      sources: { orders: true, carts: true, ai: true, shopify: true },
      rules: [],
      pairs: {},
      pairsUpdatedAt: null,
    };
  }

  function copy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  /** "gid://shopify/Product/123" | 123 | "123" -> "123", else ''. */
  function numericId(value) {
    var m = /(\d+)\s*$/.exec(String(value == null ? '' : value));
    return m ? m[1] : '';
  }

  function text(value, max, fallback) {
    var s = typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '';
    return s ? s.slice(0, max) : fallback;
  }

  function int(value, fallback, min, max) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function ref(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = numericId(raw.id);
    var handle = typeof raw.handle === 'string' ? raw.handle.replace(/[^a-z0-9\-_]/gi, '').toLowerCase().slice(0, 255) : '';
    if (!id && !handle) return null;
    var out = { id: id, handle: handle, title: text(raw.title, 120, '') };
    if (typeof raw.image === 'string' && /^(https:)?\/\//.test(raw.image)) out.image = raw.image.slice(0, 500);
    return out;
  }

  function refs(list) {
    var out = [];
    var seen = {};
    var arr = Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    for (var i = 0; i < arr.length && out.length < LIMITS.refs; i++) {
      var r = ref(arr[i]);
      var key = r ? (r.id || r.handle) : '';
      if (r && !seen[key]) { seen[key] = true; out.push(r); }
    }
    return out;
  }

  function normalizeRule(raw, index) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var w = r.when && typeof r.when === 'object' ? r.when : {};
    var s = r.show && typeof r.show === 'object' ? r.show : {};
    var when = {
      type: WHEN_TYPES.indexOf(w.type) !== -1 ? w.type : 'all',
      products: refs(w.products),
      collections: refs(w.collections),
    };
    if (when.type !== 'products') when.products = [];
    if (when.type !== 'collections') when.collections = [];
    var show = {
      type: SHOW_TYPES.indexOf(s.type) !== -1 ? s.type : 'products',
      products: refs(s.products),
      collection: ref(s.collection),
    };
    if (show.type !== 'products') show.products = [];
    if (show.type !== 'collection') show.collection = null;
    return {
      id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : 'r' + (index + 1),
      name: text(r.name, LIMITS.name, ''),
      enabled: r.enabled !== false,
      when: when,
      show: show,
    };
  }

  /** What a rule is missing before it can show anything ('' = complete). */
  function ruleProblem(rule) {
    if (rule.when.type === 'products' && !rule.when.products.length) return 'Pick the products this rule is for.';
    if (rule.when.type === 'collections' && !rule.when.collections.length) return 'Pick the collections this rule is for.';
    if (rule.show.type === 'products' && !rule.show.products.length) return 'Pick the products to show.';
    if (rule.show.type === 'collection' && !rule.show.collection) return 'Pick the collection to show products from.';
    return '';
  }

  function normalizePairs(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    var count = 0;
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      var id = numericId(key);
      var list = Object.prototype.toString.call(raw[key]) === '[object Array]' ? raw[key] : [];
      var items = [];
      for (var i = 0; i < list.length && items.length < LIMITS.pairsPerProduct; i++) {
        var r = ref(list[i]);
        if (r && r.id !== id) {
          r.source = SOURCES.indexOf(list[i].source) !== -1 ? list[i].source : 'orders';
          items.push(r);
        }
      }
      if (id && items.length) { out[id] = items; if (++count >= 2000) break; }
    }
    return out;
  }

  /** Any stored/patched value -> a complete, valid config. */
  function normalizeConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var d = defaults();
    var t = src.theme && typeof src.theme === 'object' ? src.theme : {};
    var theme = {};
    for (var key in DEFAULT_THEME) {
      if (key === 'radius') theme.radius = int(t.radius, DEFAULT_THEME.radius, 0, 32);
      else theme[key] = HEX.test(t[key] || '') ? t[key] : DEFAULT_THEME[key];
    }
    var so = src.sources && typeof src.sources === 'object' ? src.sources : {};
    var sources = {};
    for (var i = 0; i < SOURCES.length; i++) sources[SOURCES[i]] = so[SOURCES[i]] !== false;
    var rawRules = Object.prototype.toString.call(src.rules) === '[object Array]' ? src.rules : [];
    var rules = [];
    var ids = {};
    for (i = 0; i < rawRules.length && rules.length < LIMITS.rules; i++) {
      var rule = normalizeRule(rawRules[i], i);
      while (ids[rule.id]) rule.id += 'x';
      ids[rule.id] = true;
      rules.push(rule);
    }
    return {
      version: 2,
      title: text(src.title, LIMITS.title, d.title),
      style: STYLES.indexOf(src.style) !== -1 ? src.style : d.style,
      placement: PLACEMENTS.indexOf(src.placement) !== -1 ? src.placement : d.placement,
      maxItems: int(src.maxItems, d.maxItems, 1, LIMITS.maxItems),
      showCurrent: src.showCurrent !== false,
      preselect: src.preselect !== false,
      cardsAddAll: src.cardsAddAll !== false,
      theme: theme,
      sources: sources,
      rules: rules,
      pairs: normalizePairs(src.pairs),
      pairsUpdatedAt: typeof src.pairsUpdatedAt === 'string' ? src.pairsUpdatedAt.slice(0, 40) : null,
    };
  }

  /**
   * Settings saved before v2 (fbt_widget.condition rules + the chosen
   * template's colours) -> a v2 config, so a store keeps showing what it
   * showed until the merchant saves the new page.
   * legacyRules: [{ displayScope, triggerProducts: [{id, handle, title}], fbtProducts: [...] }]
   */
  function fromLegacy(legacyRules, template) {
    var tpl = template && typeof template === 'object' ? template : {};
    var rules = [];
    var pairs = {};
    var arr = Object.prototype.toString.call(legacyRules) === '[object Array]' ? legacyRules : [];
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i] || {};
      var offers = r.fbtProducts || r.fbt_products || [];
      var triggers = r.triggerProducts || r.trigger_products || [];
      // The old "AI mode" wrote one rule per product, named "AI: <title>":
      // those are automatic pairs, not the merchant's own rules.
      if (/^AI: /.test(String(r.name || '')) && triggers.length === 1) {
        var tid = numericId(triggers[0].id);
        if (tid) {
          pairs[tid] = [];
          for (var j = 0; j < offers.length; j++) { var o = copy(offers[j] || {}); o.source = 'ai'; pairs[tid].push(o); }
        }
        continue;
      }
      var all = (r.displayScope || r.trigger_scope || 'all') === 'all' || !triggers.length;
      rules.push({
        id: 'legacy' + (i + 1),
        name: r.name || '',
        when: all ? { type: 'all' } : { type: 'products', products: triggers },
        show: { type: 'products', products: offers },
      });
    }
    return normalizeConfig({
      style: tpl.interactionType === 'classic' || tpl.interactionType === 'quickAdd' ? 'cards' : 'bundle',
      cardsAddAll: tpl.showAddAllButton !== false,
      theme: {
        bg: tpl.bgColor, text: tpl.textColor, price: tpl.priceColor, button: tpl.buttonColor,
        buttonText: tpl.buttonTextColor, border: tpl.borderColor, radius: tpl.borderRadius,
      },
      placement: tpl.widgetPlacement,
      // Shopify's recommendations only once the merchant turns them on in the new page.
      sources: { orders: true, carts: true, ai: true, shopify: false },
      rules: rules,
      pairs: pairs,
    });
  }

  /**
   * Where this product page's offers come from, best first:
   *   rules for this product, then rules for its collections, then rules for
   *   every product, then the automatic pairs, then Shopify's own
   *   recommendations. product = { id, collectionIds: [], collectionHandles: [] }.
   * Returns [{ kind: 'products', items: [ref], source }, { kind: 'collection', ref, source },
   *          { kind: 'shopify' }] - the caller fills offers from them in order
   *   until it has config.maxItems.
   */
  function plan(config, product) {
    var pid = numericId(product && product.id);
    var colIds = (product && product.collectionIds) || [];
    var colHandles = (product && product.collectionHandles) || [];
    var steps = [];
    function inCollections(rule) {
      for (var i = 0; i < rule.when.collections.length; i++) {
        var c = rule.when.collections[i];
        if ((c.id && indexOf(colIds, c.id) !== -1) || (c.handle && indexOf(colHandles, c.handle) !== -1)) return true;
      }
      return false;
    }
    function forProduct(rule) {
      for (var i = 0; i < rule.when.products.length; i++) if (rule.when.products[i].id === pid) return true;
      return false;
    }
    var tiers = [
      function (r) { return r.when.type === 'products' && forProduct(r); },
      function (r) { return r.when.type === 'collections' && inCollections(r); },
      function (r) { return r.when.type === 'all'; },
    ];
    for (var t = 0; t < tiers.length; t++) {
      for (var i = 0; i < config.rules.length; i++) {
        var rule = config.rules[i];
        if (!rule.enabled || ruleProblem(rule) || !tiers[t](rule)) continue;
        if (rule.show.type === 'collection') steps.push({ kind: 'collection', ref: rule.show.collection, source: 'rule', ruleId: rule.id });
        else steps.push({ kind: 'products', items: rule.show.products, source: 'rule', ruleId: rule.id });
      }
    }
    var auto = [];
    var paired = config.pairs[pid] || [];
    for (i = 0; i < paired.length; i++) if (config.sources[paired[i].source] !== false) auto.push(paired[i]);
    if (auto.length) steps.push({ kind: 'products', items: auto, source: 'auto' });
    if (config.sources.shopify) steps.push({ kind: 'shopify', source: 'shopify' });
    return steps;
  }

  function indexOf(list, value) {
    for (var i = 0; i < list.length; i++) if (String(list[i]) === String(value)) return i;
    return -1;
  }

  /** Adds `candidates` to `picked` (no repeats, never the page's own product), up to `max`. */
  function addOffers(picked, candidates, currentId, max) {
    for (var i = 0; i < candidates.length && picked.length < max; i++) {
      var c = candidates[i];
      var key = numericId(c.id) || c.handle;
      if (!key || key === currentId) continue;
      var dup = false;
      for (var j = 0; j < picked.length; j++) if ((numericId(picked[j].id) || picked[j].handle) === key || (c.handle && picked[j].handle === c.handle)) dup = true;
      if (!dup) picked.push(c);
    }
    return picked;
  }

  /* --- money --- */

  /** Shopify money_format ("Rs. {{amount}}", "Rs.{{amount_no_decimals}}") for `cents`. HTML in the format is dropped. */
  function formatMoney(cents, format) {
    var n = Math.round(Number(cents) || 0);
    var fmt = String(format || '{{amount}}').replace(/<[^>]*>/g, '');
    function group(value, decimals, thousands, decimal) {
      var fixed = (value / 100).toFixed(decimals);
      var parts = fixed.split('.');
      var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return parts[1] ? whole + decimal + parts[1] : whole;
    }
    var m = /\{\{\s*(\w+)\s*\}\}/.exec(fmt);
    var value;
    switch (m ? m[1] : 'amount') {
      case 'amount_no_decimals': value = group(n, 0, ',', '.'); break;
      case 'amount_with_comma_separator': value = group(n, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = group(n, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': value = group(n, 2, "'", '.'); break;
      case 'amount_with_space_separator': value = group(n, 2, ' ', ','); break;
      default: value = group(n, 2, ',', '.');
    }
    return m ? fmt.replace(m[0], value) : value;
  }

  /* --- the widget --- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sizedImage(url, width) {
    var u = String(url || '');
    if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    if (!/^https:\/\//.test(u)) return '';
    return u + (u.indexOf('?') === -1 ? '?' : '&') + 'width=' + width;
  }

  /**
   * The selected items' totals in cents: { count, total, compare }.
   * item = { checked, price, compareAt } (cents, of the chosen variant).
   */
  function totals(items) {
    var out = { count: 0, total: 0, compare: 0 };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.checked) continue;
      out.count += 1;
      out.total += it.price;
      out.compare += it.compareAt > it.price ? it.compareAt : it.price;
    }
    return out;
  }

  function css() {
    return [
      '.bxf{--bxf-bg:#fff;--bxf-fg:#111827;--bxf-price:#111827;--bxf-btn:#111827;--bxf-btn-fg:#fff;--bxf-border:#e5e7eb;--bxf-r:12px;',
      'box-sizing:border-box;width:100%;margin:0;padding:18px;background:var(--bxf-bg);color:var(--bxf-fg);border:1px solid var(--bxf-border);border-radius:var(--bxf-r);font:inherit;line-height:1.4;text-align:left}',
      '.bxf *,.bxf *::before,.bxf *::after{box-sizing:border-box}',
      '.bxf-h{margin:0 0 14px;font-size:17px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--bxf-fg)}',
      '.bxf img{display:block;max-width:100%}',
      /* bundle: pictures joined by + */
      '.bxf-pics{display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 0 4px}',
      '.bxf-pics::-webkit-scrollbar{display:none}',
      '.bxf-pic{position:relative;flex:1 1 0;min-width:56px;max-width:96px;aspect-ratio:1/1;border:1px solid var(--bxf-border);border-radius:calc(var(--bxf-r) * .75);background:#f8fafc;overflow:hidden;transition:opacity .15s}',
      '.bxf-pic img{width:100%;height:100%;object-fit:contain}',
      '.bxf-pic.is-off{opacity:.35}',
      '.bxf-plus{flex:0 0 auto;font-size:20px;font-weight:600;color:var(--bxf-fg);opacity:.55}',
      '.bxf-list{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.bxf-li{display:flex;align-items:flex-start;gap:10px;margin:0;padding:0;font-size:14px}',
      '.bxf-li input[type=checkbox]{appearance:auto;-webkit-appearance:checkbox;flex:none;width:18px;height:18px;margin:2px 0 0;accent-color:var(--bxf-btn);cursor:pointer}',
      '.bxf-li-main{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px}',
      '.bxf-name{font-weight:500;color:var(--bxf-fg);text-decoration:none;word-break:break-word}',
      'a.bxf-name:hover{text-decoration:underline}',
      '.bxf-this{font-weight:700}',
      '.bxf-price{font-weight:700;color:var(--bxf-price);white-space:nowrap}',
      '.bxf-was{margin-left:4px;font-weight:400;opacity:.55;text-decoration:line-through}',
      '.bxf-sel{flex-basis:100%;max-width:240px;height:32px;padding:0 8px;font:inherit;font-size:13px;color:var(--bxf-fg);background:#fff;border:1px solid var(--bxf-border);border-radius:8px}',
      '.bxf-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-top:16px;padding-top:14px;border-top:1px solid var(--bxf-border)}',
      '.bxf-total{font-size:14px;color:var(--bxf-fg)}',
      '.bxf-total b{font-size:18px;color:var(--bxf-price)}',
      '.bxf .bxf-btn{display:inline-flex !important;align-items:center !important;justify-content:center !important;gap:6px;min-height:44px !important;margin:0 !important;padding:10px 22px !important;',
      'background:var(--bxf-btn) !important;color:var(--bxf-btn-fg) !important;border:0 !important;border-radius:calc(var(--bxf-r) * .75) !important;box-shadow:none !important;',
      'font:inherit !important;font-size:15px !important;font-weight:700 !important;letter-spacing:0 !important;text-transform:none !important;line-height:1.2 !important;cursor:pointer;width:auto !important}',
      '.bxf .bxf-btn:disabled{opacity:.45;cursor:not-allowed}',
      '.bxf .bxf-btn.is-done{filter:saturate(.6)}',
      '.bxf-status{flex-basis:100%;font-size:13px;color:#b42318;min-height:0}',
      '.bxf-status:empty{display:none}',
      /* cards: each with its own Add button */
      '.bxf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}',
      '.bxf-card{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--bxf-border);border-radius:calc(var(--bxf-r) * .75);background:var(--bxf-bg)}',
      '.bxf-card-img{display:block;aspect-ratio:1/1;border-radius:calc(var(--bxf-r) * .5);background:#f8fafc;overflow:hidden}',
      '.bxf-card-img img{width:100%;height:100%;object-fit:contain}',
      '.bxf-card .bxf-name{font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.bxf-card .bxf-sel{flex-basis:auto;max-width:none;width:100%}',
      '.bxf-card .bxf-price{white-space:normal}',
      '.bxf-card .bxf-btn{width:100% !important;margin-top:auto !important;min-height:40px !important;font-size:14px !important;padding:8px 12px !important}',
      '@media (max-width:480px){.bxf{padding:14px}.bxf-cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.bxf-foot{flex-direction:column;align-items:stretch}.bxf-foot .bxf-btn{width:100% !important}}',
    ].join('');
  }

  function themeVars(theme) {
    return '--bxf-bg:' + theme.bg + ';--bxf-fg:' + theme.text + ';--bxf-price:' + theme.price + ';--bxf-btn:' + theme.button +
      ';--bxf-btn-fg:' + theme.buttonText + ';--bxf-border:' + theme.border + ';--bxf-r:' + theme.radius + 'px';
  }

  function priceHtml(item, money) {
    return '<span class="bxf-price">' + esc(money(item.price)) +
      (item.compareAt > item.price ? '<s class="bxf-was">' + esc(money(item.compareAt)) + '</s>' : '') + '</span>';
  }

  function variantSelect(item) {
    if (!item.variants || item.variants.length < 2) return '';
    var html = '<select class="bxf-sel" data-fbt-variant="' + esc(item.key) + '" aria-label="' + esc('Option for ' + item.title) + '">';
    for (var i = 0; i < item.variants.length; i++) {
      var v = item.variants[i];
      html += '<option value="' + esc(v.id) + '"' + (String(v.id) === String(item.variantId) ? ' selected' : '') + (v.available === false ? ' disabled' : '') + '>' +
        esc(v.title + (v.available === false ? ' (sold out)' : '')) + '</option>';
    }
    return html + '</select>';
  }

  function nameHtml(item, isCurrent) {
    var label = isCurrent ? '<span class="bxf-this">This item:</span> ' + esc(item.title) : esc(item.title);
    return isCurrent || !item.url ? '<span class="bxf-name">' + label + '</span>' : '<a class="bxf-name" href="' + esc(item.url) + '">' + label + '</a>';
  }

  /**
   * The widget's HTML. view = { config, current: item | null, items: [item],
   * money: cents -> text, busy: '' | key | 'all', added: { key: true }, status: '' }.
   * item = { key, title, url, image, price, compareAt, variants, variantId, checked }.
   */
  function html(view) {
    var c = view.config;
    var money = view.money;
    var added = view.added || {};
    var out = '<div class="bxf bxf--' + c.style + '" style="' + themeVars(c.theme) + '">';
    if (c.title) out += '<p class="bxf-h">' + esc(c.title) + '</p>';
    var i;
    var item;
    if (c.style === 'bundle') {
      var all = (c.showCurrent && view.current ? [view.current] : []).concat(view.items);
      out += '<div class="bxf-pics">';
      for (i = 0; i < all.length; i++) {
        item = all[i];
        if (i) out += '<span class="bxf-plus" aria-hidden="true">+</span>';
        var img = sizedImage(item.image, 240);
        out += '<span class="bxf-pic' + (item.checked ? '' : ' is-off') + '">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '') + '</span>';
      }
      out += '</div><ul class="bxf-list">';
      for (i = 0; i < all.length; i++) {
        item = all[i];
        out += '<li class="bxf-li"><input type="checkbox" data-fbt-toggle="' + esc(item.key) + '"' + (item.checked ? ' checked' : '') +
          ' aria-label="' + esc((item.checked ? 'Remove ' : 'Add ') + item.title) + '"><span class="bxf-li-main">' +
          nameHtml(item, Boolean(view.current) && item.key === view.current.key) + priceHtml(item, money) + variantSelect(item) + '</span></li>';
      }
      out += '</ul>';
      var t = totals(all);
      var label = t.count === all.length && all.length > 1 ? 'Add all ' + t.count + ' to cart' : t.count === 1 ? 'Add to cart' : 'Add ' + t.count + ' to cart';
      out += '<div class="bxf-foot"><div class="bxf-total">Total price: <b>' + esc(money(t.total)) + '</b>' +
        (t.compare > t.total ? '<s class="bxf-was">' + esc(money(t.compare)) + '</s>' : '') + '</div>' +
        '<button type="button" class="bxf-btn" data-fbt-addall' + (t.count && view.busy !== 'all' ? '' : ' disabled') + '>' +
        esc(view.busy === 'all' ? 'Adding...' : added.all ? 'Added to cart' : label) + '</button>' +
        '<p class="bxf-status" role="status">' + esc(view.status || '') + '</p></div>';
    } else {
      out += '<div class="bxf-cards">';
      for (i = 0; i < view.items.length; i++) {
        item = view.items[i];
        var cimg = sizedImage(item.image, 360);
        out += '<div class="bxf-card">' +
          (item.url ? '<a class="bxf-card-img" href="' + esc(item.url) + '" tabindex="-1">' : '<span class="bxf-card-img">') +
          (cimg ? '<img src="' + esc(cimg) + '" alt="' + esc(item.title) + '" loading="lazy">' : '') + (item.url ? '</a>' : '</span>') +
          nameHtml(item, false) + priceHtml(item, money) + variantSelect(item) +
          '<button type="button" class="bxf-btn' + (added[item.key] ? ' is-done' : '') + '" data-fbt-add="' + esc(item.key) + '"' + (view.busy === item.key ? ' disabled' : '') + '>' +
          esc(view.busy === item.key ? 'Adding...' : added[item.key] ? 'Added' : 'Add to cart') + '</button></div>';
      }
      out += '</div>';
      if (c.cardsAddAll && view.items.length > 1) {
        var everything = (view.current ? [view.current] : []).concat(view.items);
        var forAll = [];
        for (i = 0; i < everything.length; i++) forAll.push({ checked: true, price: everything[i].price, compareAt: everything[i].compareAt });
        var ta = totals(forAll);
        out += '<div class="bxf-foot"><div class="bxf-total">' + (view.current ? 'All ' + ta.count + ' together: ' : 'All ' + ta.count + ': ') + '<b>' + esc(money(ta.total)) + '</b></div>' +
          '<button type="button" class="bxf-btn" data-fbt-addall' + (view.busy === 'all' ? ' disabled' : '') + '>' +
          esc(view.busy === 'all' ? 'Adding...' : added.all ? 'Added to cart' : 'Add all ' + ta.count + ' to cart') + '</button>' +
          '<p class="bxf-status" role="status">' + esc(view.status || '') + '</p></div>';
      } else if (view.status) {
        out += '<p class="bxf-status" role="status">' + esc(view.status) + '</p>';
      }
    }
    return out + '</div>';
  }

  /**
   * A product from /products/<handle>.js -> a widget item (prices in cents).
   * Picks the variant `preferredVariantId`, else the first available one.
   * Returns null when nothing can be bought.
   */
  function itemFromProduct(p, key, checked, preferredVariantId) {
    if (!p || !p.id) return null;
    var variants = [];
    var list = p.variants || [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      variants.push({ id: String(v.id), title: v.public_title || v.title || 'Default', price: Number(v.price) || 0, compareAt: Number(v.compare_at_price) || 0, available: v.available !== false });
    }
    var chosen = null;
    for (i = 0; i < variants.length; i++) if (preferredVariantId && variants[i].id === String(preferredVariantId) && variants[i].available) chosen = variants[i];
    for (i = 0; !chosen && i < variants.length; i++) if (variants[i].available) chosen = variants[i];
    if (!chosen) return null;
    return {
      key: key || String(p.id),
      productId: String(p.id),
      handle: p.handle || '',
      title: p.title || '',
      url: p.url || (p.handle ? '/products/' + p.handle : ''),
      image: p.featured_image || (p.images && p.images[0]) || '',
      variants: variants.length > 1 ? variants : [],
      variantId: chosen.id,
      price: chosen.price,
      compareAt: chosen.compareAt,
      checked: checked !== false,
    };
  }

  /** Switch an item to another of its variants (keeps it when that one can't be bought). */
  function chooseVariant(item, variantId) {
    for (var i = 0; i < item.variants.length; i++) {
      var v = item.variants[i];
      if (v.id === String(variantId) && v.available) {
        item.variantId = v.id;
        item.price = v.price;
        item.compareAt = v.compareAt;
        return true;
      }
    }
    return false;
  }

  return {
    STYLES: STYLES, PLACEMENTS: PLACEMENTS, WHEN_TYPES: WHEN_TYPES, SHOW_TYPES: SHOW_TYPES, SOURCES: SOURCES, LIMITS: LIMITS, DEFAULT_THEME: DEFAULT_THEME,
    defaults: defaults, numericId: numericId, normalizeConfig: normalizeConfig, normalizeRule: normalizeRule, ruleProblem: ruleProblem,
    fromLegacy: fromLegacy, plan: plan, addOffers: addOffers, formatMoney: formatMoney, totals: totals,
    css: css, html: html, esc: esc, sizedImage: sizedImage, itemFromProduct: itemFromProduct, chooseVariant: chooseVariant,
  };
}

const core = createFbtCore();

export const {
  STYLES, PLACEMENTS, WHEN_TYPES, SHOW_TYPES, SOURCES, LIMITS, DEFAULT_THEME, defaults, numericId, normalizeConfig, normalizeRule,
  ruleProblem, fromLegacy, plan, addOffers, formatMoney, totals, css, html, esc, sizedImage, itemFromProduct, chooseVariant,
} = core;
