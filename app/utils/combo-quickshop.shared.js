/**
 * Combo pages: the Quick Shop template (layout6, Pro) — one copy of its
 * filters, card data, progress and HTML.
 *
 * A shop-style grid (filter chips, Type / Brand / custom / Sort dropdowns,
 * cards with a + button) with a top progress bar and a sticky bottom bar
 * ("You unlocked 10% OFF · 5 items · ₹132 saved · Go to Cart"). The box is
 * priced by the shared combo pricing core (combo-weight.shared.js) by weight,
 * number of items or value, so it gets the same price as checkout and COD.
 *
 * createQuickShopKit(core) has no imports and uses only ES5 syntax: the
 * storefront script (combo-page[.]js.jsx) injects its source text, and the
 * builder preview (QuickShopPreview.jsx) calls the same function, so what the
 * merchant designs is exactly what shoppers get. Don't add imports, closures
 * over outside variables, or newer syntax inside the factory.
 *
 * Every merchant setting is a flat qs_* key on the combo config (DEFAULTS
 * below); a missing key means the default, an empty text means none.
 */
export function createQuickShopKit(core) {
  var DEFAULTS = {
    // Header
    qs_show_header: true,
    // Filters (the merchant picks which ones show)
    qs_chips_source: 'collections', // collections | tags | none
    qs_chip_tags: '', // "Boneless, Curry Cut, Drumstick" when source = tags
    qs_show_all_chip: true,
    qs_all_label: 'All',
    qs_filter_type: true,
    qs_filter_type_label: 'Type',
    qs_filter_brand: true,
    qs_filter_brand_label: 'Brand',
    qs_filter_custom: false,
    qs_filter_custom_label: 'Cut',
    qs_filter_custom_tags: '',
    qs_filter_sort: true,
    qs_filter_sort_label: 'Sort By',
    qs_filter_instock: false,
    qs_filter_instock_label: 'In stock',
    // Cards
    qs_columns_desktop: 4,
    qs_columns_mobile: 2,
    qs_card_eyebrow: '',
    qs_show_subtitle: true,
    qs_show_compare: true,
    qs_show_off: true,
    qs_show_weight: true,
    qs_badge_tag: 'bestseller',
    qs_badge_text: 'Bestseller',
    qs_image_ratio: 'square', // square | portrait | landscape
    qs_card_radius: 14,
    qs_card_bg: '#ffffff',
    qs_page_bg: '#f4f5f7',
    qs_text_color: '#111827',
    qs_accent: '#2563eb', // + button, chips, links
    qs_off_color: '#16a34a',
    qs_badge_bg: '#3b82f6',
    // Top progress
    qs_top_style: 'milestones', // bar | steps | milestones | text | none
    qs_top_title: 'Unlock offers on your box',
    qs_top_sticky: true,
    qs_top_offset: 0,
    qs_top_show_labels: true,
    qs_top_height: 8,
    qs_top_radius: 999,
    qs_top_bg: '#ffffff',
    qs_top_text: '#111827',
    qs_top_track: '#e5e7eb',
    qs_top_fill: '#2563eb',
    qs_top_done: '#16a34a',
    qs_tier_icons: 'gift, truck, percent, star, trophy', // built-in SVG icon names (ICONS) or https:// image links
    // Bottom bar
    qs_bar_style: 'full', // full | slim | ring | compact
    qs_bar_bg: '#ffffff',
    qs_bar_text: '#111827',
    qs_bar_save: '#16a34a',
    qs_bar_radius: 20,
    qs_bar_show_message: true,
    qs_bar_show_thumbs: true,
    qs_bar_show_saved: true,
    qs_bar_celebrate: true,
    qs_bar_icon_done: 'party',
    qs_bar_icon_locked: 'gift',
    qs_bar_icon_bg: '#16a34a',
    qs_saved_text: '{{saved}} saved, more coming up!',
    qs_saved_done_text: '{{saved}} saved!',
    qs_btn_label: 'Go to Cart',
    qs_btn_bg: '#2563eb',
    qs_btn_text_color: '#ffffff',
    qs_btn_radius: 14,
    qs_btn_action: 'checkout', // checkout | cart
    // Checkout with: shopify | shiprocket (BRIX one-time code for the box discount)
    // | shiprocket_own (the merchant's own Shiprocket offer). Shiprocket only on
    // shops with it switched on (integrations_admin.php) and with qs_btn_action checkout.
    qs_checkout_with: 'shopify',
    qs_require_first_tier: false,
  };

  var SORTS = [
    { value: 'featured', label: 'Featured' },
    { value: 'price_asc', label: 'Price: low to high' },
    { value: 'price_desc', label: 'Price: high to low' },
    { value: 'discount', label: 'Biggest discount' },
    { value: 'name', label: 'Name: A to Z' },
  ];

  // A missing key is the default; an empty text stays empty (e.g. no badge).
  function opt(config, key) {
    var v = config ? config[key] : undefined;
    return v === undefined || v === null ? DEFAULTS[key] : v;
  }

  function on(config, key) {
    var v = opt(config, key);
    return v === true || v === 'true' || v === 1;
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Colours etc. are only ever put in style="" after this check. */
  function safeCss(value, fallback) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    return /^[#\w\s.,%()-]{1,60}$/.test(s) ? s : fallback;
  }

  function num(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function money(amount, symbol) {
    var n = Math.max(0, Number(amount) || 0);
    var text = Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2);
    return (symbol || '') + text;
  }

  function list(text) {
    var out = [];
    var parts = String(text || '').split(',');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/\s+/g, ' ').trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  // One icon per tier, by position: unlike list(), repeats are kept (the same
  // icon on every tier is allowed).
  function iconList(text) {
    var out = [];
    var parts = String(text || '').split(',');
    for (var i = 0; i < parts.length; i++) out.push(parts[i].trim());
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }

  function lower(s) { return String(s || '').toLowerCase(); }

  function hasTag(product, tag) {
    var tags = product.tags || [];
    for (var i = 0; i < tags.length; i++) if (lower(tags[i]) === lower(tag)) return true;
    return false;
  }

  /** "10% OFF" / "₹100 OFF" / "Box at ₹499": what a tier gives, for the page. */
  function offerText(tier, symbol) {
    if (tier.label) return tier.label;
    if (tier.type === 'percentage') return tier.value + '% OFF';
    if (tier.type === 'fixed_amount') return money(tier.value, symbol) + ' OFF';
    return 'Box at ' + money(tier.value, symbol);
  }

  /** The tiers with their page labels (merchant label, else the offer). */
  function labelledTiers(tiers, symbol) {
    var out = [];
    for (var i = 0; i < (tiers || []).length; i++) {
      var t = tiers[i];
      out.push({ id: t.id, min_grams: t.min_grams, type: t.type, value: t.value, label: offerText(t, symbol) });
    }
    return out;
  }

  function isIconUrl(icon) { return /^https:\/\/[^\s"'<>]+$/.test(icon); }

  // Built-in line icons (no emoji anywhere): drawn in currentColor, so each
  // place colours them (white on the unlocked circle, the bar colour before).
  var ICON_PATHS = {
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    crown: '<path d="m3 7 4.5 4L12 5l4.5 6L21 7l-2 11H5z"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    party: '<path d="M4 20 8.5 7.5l8 8z"/><path d="M13 3.5v2M18.5 9h2M16 6l2.5-2.5M14 10l5-5"/>',
    sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    heart: '<path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  };
  var ICON_NAMES = ['gift', 'truck', 'percent', 'star', 'trophy', 'crown', 'tag', 'coins', 'party', 'sparkles', 'heart', 'box', 'bolt', 'check'];
  // Tiers without a chosen icon get a different one each, in this order.
  var TIER_ICON_ORDER = ['gift', 'truck', 'percent', 'star', 'trophy', 'crown'];
  // Emoji saved before the icon set existed, drawn as the matching icon.
  var EMOJI_ICONS = { '🎁': 'gift', '🚚': 'truck', '💰': 'coins', '💸': 'coins', '⭐': 'star', '🌟': 'star', '🏆': 'trophy', '👑': 'crown', '🎉': 'party', '🥳': 'party', '✨': 'sparkles', '❤️': 'heart', '📦': 'box', '⚡': 'bolt', '✅': 'check', '🏷️': 'tag', '%': 'percent' };

  function svgIcon(name) {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + ICON_PATHS[name] + '</svg>';
  }

  /**
   * The icon name to draw for a setting value. fallback: an icon name, or a
   * tier position (each tier gets a different icon from TIER_ICON_ORDER).
   */
  function iconName(icon, fallback) {
    var s = String(icon === null || icon === undefined ? '' : icon).trim();
    var lower = s.toLowerCase();
    if (ICON_PATHS[lower]) return lower;
    if (EMOJI_ICONS[s]) return EMOJI_ICONS[s];
    if (typeof fallback === 'string' && ICON_PATHS[fallback]) return fallback;
    return TIER_ICON_ORDER[(Number(fallback) || 0) % TIER_ICON_ORDER.length];
  }

  function iconHtml(icon, cls, i) {
    if (!icon) return '';
    if (isIconUrl(icon)) return '<img class="' + cls + '" src="' + esc(icon) + '" alt="" />';
    return '<span class="' + cls + '" aria-hidden="true">' + svgIcon(iconName(icon, i)) + '</span>';
  }

  /* ── products: variants, filters, sorting ───────────────────────────── */

  function activeVariant(product, pending) {
    var variants = product.variants || [];
    var id = pending && pending[product.id];
    for (var i = 0; i < variants.length; i++) if (id && String(variants[i].id) === String(id)) return variants[i];
    return variants[0] || null;
  }

  function priceOf(product, variant) {
    var p = variant && variant.price !== null && variant.price !== undefined ? parseFloat(variant.price) : parseFloat(product.price || 0);
    return isFinite(p) ? p : 0;
  }

  function compareOf(variant, price) {
    var c = variant && variant.compareAtPrice !== null && variant.compareAtPrice !== undefined ? parseFloat(variant.compareAtPrice) : 0;
    return isFinite(c) && c > price ? c : 0;
  }

  /** Unique products of the shown collections, in collection order. */
  function allProducts(productsByHandle, handles) {
    var seen = {};
    var out = [];
    for (var h = 0; h < handles.length; h++) {
      var prods = productsByHandle[handles[h]] || [];
      for (var i = 0; i < prods.length; i++) {
        if (seen[prods[i].id]) continue;
        seen[prods[i].id] = true;
        out.push(prods[i]);
      }
    }
    return out;
  }

  function uniqueValues(products, field) {
    var out = [];
    for (var i = 0; i < products.length; i++) {
      var v = String(products[i][field] || '').trim();
      if (v && out.indexOf(v) === -1) out.push(v);
    }
    out.sort();
    return out;
  }

  /**
   * The filter row: chips + dropdown menus, from the merchant's choices and
   * the products on the page. ui = { chip, dd: { type, brand, custom, sort }, instock, menu }.
   */
  function filterRow(config, products, handles, collectionNames, ui) {
    var chips = [];
    var source = opt(config, 'qs_chips_source');
    var chipValues = [];
    if (source === 'collections' && handles.length > 1) {
      for (var h = 0; h < handles.length; h++) chipValues.push({ value: 'c:' + handles[h], label: collectionNames[handles[h]] || handles[h] });
    } else if (source === 'tags') {
      var tags = list(opt(config, 'qs_chip_tags'));
      for (var t = 0; t < tags.length; t++) chipValues.push({ value: 't:' + tags[t], label: tags[t] });
    }
    if (chipValues.length) {
      if (on(config, 'qs_show_all_chip')) chips.push({ value: 'all', label: opt(config, 'qs_all_label'), on: !ui.chip || ui.chip === 'all' });
      for (var c = 0; c < chipValues.length; c++) {
        chipValues[c].on = ui.chip === chipValues[c].value;
        chips.push(chipValues[c]);
      }
    }
    if (on(config, 'qs_filter_instock')) chips.push({ value: 'instock', label: opt(config, 'qs_filter_instock_label'), on: !!ui.instock, toggle: true });

    var dd = ui.dd || {};
    var menus = [];
    function addMenu(id, label, values) {
      if (values.length < 2) return;
      var options = [{ value: '', label: 'All' }];
      for (var i = 0; i < values.length; i++) options.push({ value: values[i], label: values[i] });
      menus.push({ id: id, label: label, value: dd[id] || '', options: options, open: ui.menu === id });
    }
    if (on(config, 'qs_filter_type')) addMenu('type', opt(config, 'qs_filter_type_label'), uniqueValues(products, 'productType'));
    if (on(config, 'qs_filter_brand')) addMenu('brand', opt(config, 'qs_filter_brand_label'), uniqueValues(products, 'vendor'));
    if (on(config, 'qs_filter_custom')) {
      var custom = list(opt(config, 'qs_filter_custom_tags'));
      var present = [];
      for (var k = 0; k < custom.length; k++) {
        for (var p = 0; p < products.length; p++) if (hasTag(products[p], custom[k])) { present.push(custom[k]); break; }
      }
      // In the builder (no tags on demo products) still show what was typed.
      addMenu('custom', opt(config, 'qs_filter_custom_label'), present.length ? present : custom);
    }
    if (on(config, 'qs_filter_sort')) {
      menus.push({ id: 'sort', label: opt(config, 'qs_filter_sort_label'), value: dd.sort && dd.sort !== 'featured' ? dd.sort : '', options: SORTS, open: ui.menu === 'sort', isSort: true });
    }
    var active = (ui.chip && ui.chip !== 'all') || !!ui.instock || !!dd.type || !!dd.brand || !!dd.custom || (dd.sort && dd.sort !== 'featured');
    return { chips: chips, menus: menus, active: !!active };
  }

  function filterProducts(products, productsByHandle, ui, pending) {
    var dd = ui.dd || {};
    var inChip = null;
    if (ui.chip && ui.chip.indexOf('c:') === 0) {
      inChip = {};
      var prods = productsByHandle[ui.chip.slice(2)] || [];
      for (var i = 0; i < prods.length; i++) inChip[prods[i].id] = true;
    }
    var out = [];
    for (var j = 0; j < products.length; j++) {
      var p = products[j];
      if (inChip && !inChip[p.id]) continue;
      if (ui.chip && ui.chip.indexOf('t:') === 0 && !hasTag(p, ui.chip.slice(2))) continue;
      if (dd.type && String(p.productType || '') !== dd.type) continue;
      if (dd.brand && String(p.vendor || '') !== dd.brand) continue;
      if (dd.custom && !hasTag(p, dd.custom)) continue;
      if (ui.instock) {
        var anyAvailable = false;
        for (var v = 0; v < (p.variants || []).length; v++) if (p.variants[v].available !== false) anyAvailable = true;
        if (!anyAvailable) continue;
      }
      out.push(p);
    }
    var sort = dd.sort || 'featured';
    if (sort !== 'featured') {
      var keyed = [];
      for (var k = 0; k < out.length; k++) {
        var variant = activeVariant(out[k], pending);
        var price = priceOf(out[k], variant);
        var cmp = compareOf(variant, price);
        keyed.push({ p: out[k], i: k, price: price, off: cmp ? (cmp - price) / cmp : 0, name: lower(out[k].title) });
      }
      keyed.sort(function (a, b) {
        var d = 0;
        if (sort === 'price_asc') d = a.price - b.price;
        else if (sort === 'price_desc') d = b.price - a.price;
        else if (sort === 'discount') d = b.off - a.off;
        else if (sort === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        return d || a.i - b.i;
      });
      out = [];
      for (var s = 0; s < keyed.length; s++) out.push(keyed[s].p);
    }
    return out;
  }

  /* ── the box: price, progress, savings ──────────────────────────────── */

  /** May this box be checked out? Quick Shop lets any box through unless the merchant requires the first tier. */
  function canCheckout(config, box, items, tiers) {
    if (!(items > 0) || box.overMax) return false;
    if (!on(config, 'qs_require_first_tier')) return true;
    return !!box.tier || !(tiers && tiers.length);
  }

  /** The top progress line: what's unlocked · what's next (or the max-weight error). */
  function topMessage(view, box) {
    if (!view.enabled) return { tone: 'muted', text: '' };
    if (box.overMax) return core.boxMessage(view, box);
    var now = barMessage(view, box);
    if (!box.tier || !box.nextTier) return { tone: now.tone, text: now.text };
    var next = barMessage(view, { overMax: false, tier: null, nextTier: box.nextTier, remaining: box.remaining, amount: box.amount, decimals: box.decimals });
    return { tone: 'success', text: now.text + ' · ' + next.text };
  }

  /** What the bottom bar says: { tone, text, tier } (tier = the label to bold). */
  function barMessage(view, box) {
    var msgs = view.messages || core.DEFAULT_MESSAGES;
    if (box.overMax) return core.boxMessage(view, box);
    if (!view.enabled) return { tone: 'muted', text: '', tier: '' };
    if (box.tier) return { tone: 'success', text: core.fillMessage(msgs.unlocked || core.DEFAULT_MESSAGES.unlocked, { tier: box.tier.label }), tier: box.tier.label };
    if (box.nextTier) {
      return {
        tone: 'muted',
        text: core.fillMessage(msgs.locked || core.DEFAULT_MESSAGES.locked, {
          remaining: core.formatAmount(view, box.remaining, box.decimals, true),
          tier: box.nextTier.label,
          weight: core.formatAmount(view, box.amount, box.decimals),
          amount: core.formatAmount(view, box.amount, box.decimals),
        }),
        tier: box.nextTier.label,
      };
    }
    return { tone: 'muted', text: '', tier: '' };
  }

  /**
   * Everything the page shows, from plain data (both the storefront and the
   * builder call this, then render()):
   *   config, productsByHandle, handles, collectionNames
   *   selection  { [variantId]: { productId, qty } }
   *   pending    { [productId]: variantId } (card dropdowns)
   *   ui         { chip, dd, instock, menu, sheetOpen, celebrate, checkingOut, toast }
   *   pricing    { measure, unit, tiers, maxGrams, messages, enabled } (normalized, from the server)
   *   qualifies  function (productId) → counts toward the box
   *   symbol, decimals, isMobile, cod { shown, placement, text, css, icon }
   */
  function buildModel(input) {
    var config = input.config || {};
    var ui = input.ui || {};
    var symbol = input.symbol || '';
    var decimals = input.decimals === undefined ? 2 : input.decimals;
    var pricing = input.pricing || { tiers: [], enabled: false };
    var tiers = labelledTiers(pricing.tiers, symbol);
    var view = {
      measure: pricing.measure || 'weight', unit: pricing.unit || 'kg', tiers: tiers,
      maxGrams: pricing.maxGrams === undefined ? null : pricing.maxGrams,
      messages: pricing.messages, enabled: !!pricing.enabled, currencySymbol: symbol,
    };
    var handles = input.handles || [];
    var all = allProducts(input.productsByHandle || {}, handles);
    if (!all.length && input.fallbackProducts) all = input.fallbackProducts;
    var byId = {};
    for (var a = 0; a < all.length; a++) byId[all[a].id] = all[a];
    var extra = input.extraProducts || [];
    for (var e = 0; e < extra.length; e++) if (!byId[extra[e].id]) byId[extra[e].id] = extra[e];

    // The box.
    var selection = input.selection || {};
    var lines = [];
    var items = 0;
    var total = 0;
    var compareSavings = 0;
    var thumbs = [];
    var sheet = [];
    var qtyByVariant = {};
    for (var vid in selection) {
      if (!Object.prototype.hasOwnProperty.call(selection, vid)) continue;
      var sel = selection[vid];
      var qty = Number(sel.qty) || 0;
      if (qty <= 0) continue;
      var product = byId[sel.productId];
      var variant = null;
      if (product) for (var vi = 0; vi < (product.variants || []).length; vi++) if (String(product.variants[vi].id) === String(vid)) variant = product.variants[vi];
      var price = product ? priceOf(product, variant) : 0;
      var cmp = compareOf(variant, price);
      qtyByVariant[vid] = qty;
      items += qty;
      total += price * qty;
      if (cmp) compareSavings += (cmp - price) * qty;
      var image = (variant && variant.image && (variant.image.url || variant.image.src)) || (product && product.image && (product.image.url || product.image.src)) || '';
      if (image && thumbs.length < 3) thumbs.push(image);
      sheet.push({
        variantId: vid, productId: sel.productId, qty: qty, image: image,
        title: product ? product.title : '', variantTitle: variant && variant.title !== 'Default Title' ? variant.title : '',
        price: money(price * qty, symbol),
      });
      lines.push({
        key: vid,
        unitGrams: variant && variant.grams > 0 ? variant.grams : null,
        quantity: qty,
        subtotalMinor: core.toMinor(price * qty, decimals),
        qualifies: input.qualifies ? !!input.qualifies(sel.productId) : true,
      });
    }
    var box = core.computeBox({ pricing: { measure: view.measure, tiers: tiers, max_grams: view.maxGrams, unit: view.unit }, lines: lines, decimals: decimals, rate: 1 });
    var boxDiscount = view.enabled ? box.discountMinor / Math.pow(10, decimals) : 0;
    var saved = compareSavings + boxDiscount;
    var finalPrice = Math.max(0, total - boxDiscount);
    var progress = core.progressOf(view, box, 1);
    var icons = iconList(opt(config, 'qs_tier_icons'));
    for (var m = 0; m < progress.marks.length; m++) {
      var mark = progress.marks[m];
      mark.label = mark.tier.label;
      mark.at = core.formatThreshold(view, mark.tier);
      // A tier past the list gets its own icon, not a repeat of the last one.
      mark.icon = icons.length ? (icons[m] || TIER_ICON_ORDER[m % TIER_ICON_ORDER.length]) : '';
      mark.iconIndex = m;
    }

    // Cards.
    var row = filterRow(config, all, handles, input.collectionNames || {}, ui);
    var shown = filterProducts(all, input.productsByHandle || {}, ui, input.pending);
    var cards = [];
    var badgeTag = String(opt(config, 'qs_badge_tag') || '').trim();
    for (var c = 0; c < shown.length; c++) {
      var p = shown[c];
      var v = activeVariant(p, input.pending);
      var pr = priceOf(p, v);
      var cp = compareOf(v, pr);
      var options = [];
      for (var o = 0; o < (p.variants || []).length; o++) {
        var pv = p.variants[o];
        options.push({ id: pv.id, title: pv.title, on: v && String(pv.id) === String(v.id), available: pv.available !== false });
      }
      var weightText = '';
      if (v && v.grams > 0) weightText = core.formatWeight(v.grams, v.grams < 1000 ? 'g' : 'kg');
      var img = (v && v.image && (v.image.url || v.image.src)) || (p.image && (p.image.url || p.image.src)) || (p.images && p.images[0] && p.images[0].url) || '';
      cards.push({
        id: p.id, title: p.title, summary: p.summary || '', image: img,
        badge: badgeTag && hasTag(p, badgeTag) ? (opt(config, 'qs_badge_text') || badgeTag) : '',
        variants: options.length > 1 && !(options.length === 1 && options[0].title === 'Default Title') ? options : [],
        weightText: weightText,
        price: money(pr, symbol), compare: cp ? money(cp, symbol) : '', off: cp ? Math.round(((cp - pr) / cp) * 100) : 0,
        available: !v || v.available !== false,
        variantId: v ? v.id : '',
        qty: v ? (qtyByVariant[v.id] || 0) : 0,
        counts: input.qualifies ? !!input.qualifies(p.id) : true,
      });
    }

    var bar = barMessage(view, box);
    var savedTemplate = box.nextTier && view.enabled ? opt(config, 'qs_saved_text') : opt(config, 'qs_saved_done_text');
    return {
      config: config,
      isMobile: !!input.isMobile,
      symbol: symbol,
      title: config.collection_title || input.templateName || '',
      description: config.collection_description || '',
      row: row,
      cards: cards,
      empty: !all.length ? 'No products yet. Choose collections for this combo.' : (!cards.length ? 'Nothing matches these filters.' : ''),
      view: view,
      box: box,
      progress: progress,
      topMessage: topMessage(view, box),
      bar: {
        items: items,
        thumbs: thumbs,
        sheet: sheet,
        message: bar,
        saved: saved > 0.004 ? core.fillMessage(savedTemplate, { saved: money(saved, symbol) }) : '',
        total: money(finalPrice, symbol),
        canCheckout: canCheckout(config, box, items, tiers) && !ui.checkingOut,
        checkingOut: !!ui.checkingOut,
        sheetOpen: !!ui.sheetOpen,
        celebrate: !!ui.celebrate,
      },
      totals: { total: total, discount: boxDiscount, finalPrice: finalPrice, saved: saved, items: items },
      cod: input.cod || { shown: false },
      toast: ui.toast || '',
    };
  }

  /* ── HTML ───────────────────────────────────────────────────────────── */

  var ICON_PLUS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  var ICON_FILTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';

  function vars(config) {
    var pairs = [
      ['--bxq-page', safeCss(opt(config, 'qs_page_bg'), DEFAULTS.qs_page_bg)],
      ['--bxq-card', safeCss(opt(config, 'qs_card_bg'), DEFAULTS.qs_card_bg)],
      ['--bxq-text', safeCss(opt(config, 'qs_text_color'), DEFAULTS.qs_text_color)],
      ['--bxq-accent', safeCss(opt(config, 'qs_accent'), DEFAULTS.qs_accent)],
      ['--bxq-off', safeCss(opt(config, 'qs_off_color'), DEFAULTS.qs_off_color)],
      ['--bxq-badge', safeCss(opt(config, 'qs_badge_bg'), DEFAULTS.qs_badge_bg)],
      ['--bxq-radius', num(opt(config, 'qs_card_radius'), 14, 0, 40) + 'px'],
      ['--bxq-ratio', { portrait: '4/5', landscape: '4/3' }[opt(config, 'qs_image_ratio')] || '1/1'],
      ['--bxq-cols', String(num(opt(config, 'qs_columns_desktop'), 4, 2, 6))],
      ['--bxq-cols-m', String(num(opt(config, 'qs_columns_mobile'), 2, 1, 3))],
      ['--bxq-top-bg', safeCss(opt(config, 'qs_top_bg'), DEFAULTS.qs_top_bg)],
      ['--bxq-top-text', safeCss(opt(config, 'qs_top_text'), DEFAULTS.qs_top_text)],
      ['--bxq-track', safeCss(opt(config, 'qs_top_track'), DEFAULTS.qs_top_track)],
      ['--bxq-fill', safeCss(opt(config, 'qs_top_fill'), DEFAULTS.qs_top_fill)],
      ['--bxq-done', safeCss(opt(config, 'qs_top_done'), DEFAULTS.qs_top_done)],
      ['--bxq-top-h', num(opt(config, 'qs_top_height'), 8, 2, 24) + 'px'],
      ['--bxq-top-r', num(opt(config, 'qs_top_radius'), 999, 0, 999) + 'px'],
      ['--bxq-top-offset', num(opt(config, 'qs_top_offset'), 0, 0, 300) + 'px'],
      ['--bxq-bar-bg', safeCss(opt(config, 'qs_bar_bg'), DEFAULTS.qs_bar_bg)],
      ['--bxq-bar-text', safeCss(opt(config, 'qs_bar_text'), DEFAULTS.qs_bar_text)],
      ['--bxq-save', safeCss(opt(config, 'qs_bar_save'), DEFAULTS.qs_bar_save)],
      ['--bxq-bar-r', num(opt(config, 'qs_bar_radius'), 20, 0, 40) + 'px'],
      ['--bxq-icon-bg', safeCss(opt(config, 'qs_bar_icon_bg'), DEFAULTS.qs_bar_icon_bg)],
      ['--bxq-btn', safeCss(opt(config, 'qs_btn_bg'), DEFAULTS.qs_btn_bg)],
      ['--bxq-btn-text', safeCss(opt(config, 'qs_btn_text_color'), DEFAULTS.qs_btn_text_color)],
      ['--bxq-btn-r', num(opt(config, 'qs_btn_radius'), 14, 0, 40) + 'px'],
    ];
    var out = '';
    for (var i = 0; i < pairs.length; i++) out += pairs[i][0] + ':' + pairs[i][1] + ';';
    return out;
  }

  /** Escaped text with the tier label in bold. */
  function boldTier(text, tier) {
    var html = esc(text);
    if (!tier) return html;
    var t = esc(tier);
    var at = html.indexOf(t);
    return at === -1 ? html : html.slice(0, at) + '<b>' + t + '</b>' + html.slice(at + t.length);
  }

  function renderFilters(model) {
    var row = model.row;
    if (!row.chips.length && !row.menus.length) return '';
    var html = '<div class="bxq-filters">';
    html += '<button type="button" class="bxq-chip bxq-chip--icon' + (row.active ? ' is-active' : '') + '" data-combo-action="qs-clear" aria-label="Clear filters" title="Clear filters">' + ICON_FILTER + '</button>';
    for (var i = 0; i < row.chips.length; i++) {
      var chip = row.chips[i];
      html += '<button type="button" class="bxq-chip' + (chip.on ? ' is-on' : '') + '" aria-pressed="' + (chip.on ? 'true' : 'false') + '" data-combo-action="' + (chip.toggle ? 'qs-instock' : 'qs-chip') + '" data-value="' + esc(chip.value) + '">' + esc(chip.label) + '</button>';
    }
    for (var m = 0; m < row.menus.length; m++) {
      var menu = row.menus[m];
      var current = '';
      for (var o = 0; o < menu.options.length; o++) if (menu.value && menu.options[o].value === menu.value) current = menu.options[o].label;
      html += '<div class="bxq-dd' + (menu.open ? ' is-open' : '') + '">';
      html += '<button type="button" class="bxq-chip' + (menu.value ? ' is-on' : '') + '" aria-expanded="' + (menu.open ? 'true' : 'false') + '" data-combo-action="qs-menu" data-menu="' + esc(menu.id) + '">'
        + esc(menu.isSort || !current ? menu.label : current) + ICON_DOWN + '</button>';
      if (menu.open) {
        html += '<div class="bxq-menu" role="listbox">';
        for (var k = 0; k < menu.options.length; k++) {
          var option = menu.options[k];
          var selected = (option.value || '') === (menu.value || '') || (menu.isSort && !menu.value && option.value === 'featured');
          html += '<button type="button" role="option" aria-selected="' + (selected ? 'true' : 'false') + '" class="bxq-opt' + (selected ? ' is-on' : '') + '" data-combo-action="qs-pick" data-menu="' + esc(menu.id) + '" data-value="' + esc(option.value) + '">' + esc(option.label) + '</button>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderTop(model) {
    var config = model.config;
    var style = opt(config, 'qs_top_style');
    if (style === 'none' || !model.view.enabled || !model.view.tiers.length) return '';
    var progress = model.progress;
    var msg = model.topMessage;
    var labels = on(config, 'qs_top_show_labels');
    var html = '<section class="bxq-top bxq-top--' + esc(style) + (on(config, 'qs_top_sticky') ? ' is-sticky' : '') + '" aria-label="Offer progress">';
    var title = opt(config, 'qs_top_title');
    if (title) html += '<div class="bxq-top-title">' + esc(title) + '</div>';
    html += '<p class="bxq-top-msg is-' + esc(msg.tone) + '" aria-live="polite">' + esc(msg.text) + '</p>';
    var i;
    if (style === 'bar') {
      html += '<div class="bxq-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(progress.percent) + '"><div class="bxq-fill' + (model.box.tier ? ' is-done' : '') + '" style="width:' + progress.percent.toFixed(1) + '%"></div>';
      for (i = 0; i < progress.marks.length; i++) {
        html += '<span class="bxq-tick' + (progress.marks[i].hit ? ' is-hit' : '') + '" style="left:' + progress.marks[i].percent.toFixed(1) + '%"></span>';
      }
      html += '</div>';
      if (labels) {
        html += '<div class="bxq-ticks">';
        for (i = 0; i < progress.marks.length; i++) {
          var mk = progress.marks[i];
          html += '<span class="bxq-tick-label' + (mk.hit ? ' is-hit' : '') + '" style="left:' + mk.percent.toFixed(1) + '%"><b>' + esc(mk.label) + '</b><small>' + esc(mk.at) + '</small></span>';
        }
        html += '</div>';
      }
    } else if (style === 'steps') {
      html += '<div class="bxq-steps">';
      var prev = 0;
      for (i = 0; i < progress.marks.length; i++) {
        var step = progress.marks[i];
        var span = Math.max(0.0001, step.percent - prev);
        var fill = Math.max(0, Math.min(100, ((progress.percent - prev) / span) * 100));
        html += '<div class="bxq-step' + (step.hit ? ' is-hit' : '') + (step.next ? ' is-next' : '') + '">'
          + '<div class="bxq-step-track"><div class="bxq-step-fill" style="width:' + fill.toFixed(1) + '%"></div></div>'
          + (labels ? '<div class="bxq-step-label"><b>' + esc(step.label) + '</b><small>' + esc(step.at) + '</small></div>' : '')
          + '</div>';
        prev = step.percent;
      }
      html += '</div>';
    } else if (style === 'milestones') {
      html += '<div class="bxq-miles"><div class="bxq-miles-line"><div class="bxq-miles-fill" style="width:' + progress.percent.toFixed(1) + '%"></div></div>';
      for (i = 0; i < progress.marks.length; i++) {
        var ms = progress.marks[i];
        html += '<div class="bxq-mile' + (ms.hit ? ' is-hit' : '') + (ms.next ? ' is-next' : '') + '" style="left:' + ms.percent.toFixed(1) + '%">'
          + '<span class="bxq-mile-dot">' + (ms.icon ? iconHtml(ms.icon, 'bxq-mile-icon', ms.iconIndex) : '') + '</span>'
          + (labels ? '<span class="bxq-mile-label"><b>' + esc(ms.label) + '</b><small>' + esc(ms.at) + '</small></span>' : '')
          + '</div>';
      }
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  function renderCard(model, card) {
    var config = model.config;
    var html = '<article class="bxq-card' + (card.qty ? ' is-in' : '') + (card.available ? '' : ' is-out') + '" data-product-id="' + esc(card.id) + '">';
    html += '<div class="bxq-media">';
    html += card.image ? '<img src="' + esc(card.image) + '" alt="' + esc(card.title) + '" loading="lazy" />' : '<span class="bxq-noimg"></span>';
    if (card.badge) html += '<span class="bxq-badge">' + esc(card.badge) + '</span>';
    if (!card.available) {
      html += '<span class="bxq-soldout">Out of stock</span>';
    } else if (card.qty > 0) {
      html += '<div class="bxq-stepper"><button type="button" data-combo-action="qty-dec" data-product-id="' + esc(card.id) + '" aria-label="Remove one">−</button>'
        + '<span aria-live="polite">' + card.qty + '</span>'
        + '<button type="button" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" aria-label="Add one">+</button></div>';
    } else {
      html += '<button type="button" class="bxq-add" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" aria-label="Add ' + esc(card.title) + '">' + ICON_PLUS + '</button>';
    }
    html += '</div><div class="bxq-info">';
    var eyebrow = opt(config, 'qs_card_eyebrow');
    if (eyebrow) html += '<div class="bxq-eyebrow">' + esc(eyebrow) + '</div>';
    html += '<h3 class="bxq-name">' + esc(card.title) + '</h3>';
    if (on(config, 'qs_show_subtitle') && card.summary) html += '<p class="bxq-sub">' + esc(card.summary) + '</p>';
    if (card.variants.length) {
      html += '<label class="bxq-variant"><select data-combo-action="variant-select" data-product-id="' + esc(card.id) + '" aria-label="Choose an option">';
      for (var i = 0; i < card.variants.length; i++) {
        var v = card.variants[i];
        html += '<option value="' + esc(v.id) + '"' + (v.on ? ' selected' : '') + (v.available ? '' : ' disabled') + '>' + esc(v.title) + (v.available ? '' : ' (sold out)') + '</option>';
      }
      html += '</select>' + ICON_DOWN + '</label>';
    } else if (card.weightText && on(config, 'qs_show_weight')) {
      html += '<div class="bxq-variant is-static">' + esc(card.weightText) + '</div>';
    }
    if (card.off && on(config, 'qs_show_off')) html += '<div class="bxq-off"><span>' + card.off + '% OFF</span></div>';
    html += '<div class="bxq-price"><b>' + esc(card.price) + '</b>' + (card.compare && on(config, 'qs_show_compare') ? '<s>' + esc(card.compare) + '</s>' : '') + '</div>';
    if (!card.counts && model.view.enabled) html += '<div class="bxq-nocount">Not part of the box offer</div>';
    html += '</div></article>';
    return html;
  }

  function renderBar(model) {
    var config = model.config;
    var bar = model.bar;
    if (!bar.items) return '';
    var style = opt(config, 'qs_bar_style');
    var cod = model.cod || {};
    var codPlacement = cod.placement === 'replace' || cod.placement === 'above' ? cod.placement : 'below';
    var disabled = !bar.canCheckout;
    var html = '<div class="bxq-bar bxq-bar--' + esc(style) + (bar.celebrate ? ' is-celebrate' : '') + '" role="region" aria-label="Your box">';

    if (bar.sheetOpen) {
      html += '<div class="bxq-sheet">';
      for (var s = 0; s < bar.sheet.length; s++) {
        var line = bar.sheet[s];
        html += '<div class="bxq-line">' + (line.image ? '<img src="' + esc(line.image) + '" alt="" />' : '<span class="bxq-noimg"></span>')
          + '<div class="bxq-line-main"><div class="bxq-line-name">' + esc(line.title) + '</div>' + (line.variantTitle ? '<div class="bxq-line-sub">' + esc(line.variantTitle) + '</div>' : '') + '</div>'
          + '<div class="bxq-mini"><button type="button" data-combo-action="box-dec" data-variant-id="' + esc(line.variantId) + '" aria-label="Remove one">−</button><span>' + line.qty + '</span>'
          + '<button type="button" data-combo-action="box-inc" data-variant-id="' + esc(line.variantId) + '" aria-label="Add one">+</button></div>'
          + '<div class="bxq-line-price">' + esc(line.price) + '</div></div>';
      }
      html += '<button type="button" class="bxq-clear" data-combo-action="reset">Remove all</button></div>';
    }

    var msg = bar.message;
    var showMessage = on(config, 'qs_bar_show_message') && msg.text;
    var progress = model.progress;
    if (style === 'slim' && model.view.enabled && model.view.tiers.length) {
      html += '<div class="bxq-slim"><div class="bxq-slim-fill' + (model.box.tier ? ' is-done' : '') + '" style="width:' + progress.percent.toFixed(1) + '%"></div></div>';
    }
    if (showMessage && style !== 'compact') {
      var icon = model.box.tier ? opt(config, 'qs_bar_icon_done') : opt(config, 'qs_bar_icon_locked');
      html += '<div class="bxq-msg is-' + esc(msg.tone) + '">';
      if (style === 'full' && icon) html += '<span class="bxq-msg-icon">' + iconHtml(icon, 'bxq-msg-glyph', model.box.tier ? 'party' : 'gift') + '</span>';
      html += '<span aria-live="polite">' + boldTier(msg.text, msg.tier) + '</span></div>';
    }

    html += '<div class="bxq-row">';
    if (style === 'ring') {
      var r = 18;
      var circ = 2 * Math.PI * r;
      var pct = model.view.enabled && model.view.tiers.length ? progress.percent : 100;
      html += '<span class="bxq-ring' + (model.box.tier ? ' is-done' : '') + '"><svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="' + r + '" class="bxq-ring-bg"/><circle cx="22" cy="22" r="' + r + '" class="bxq-ring-fg" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + (circ * (1 - pct / 100)).toFixed(2) + '"/></svg><b>' + bar.items + '</b></span>';
    } else if (on(config, 'qs_bar_show_thumbs') && bar.thumbs.length && style !== 'compact') {
      html += '<span class="bxq-thumbs">';
      for (var t = 0; t < bar.thumbs.length; t++) html += '<img src="' + esc(bar.thumbs[t]) + '" alt="" style="z-index:' + (3 - t) + '" />';
      html += '</span>';
    }
    html += '<button type="button" class="bxq-count" data-combo-action="' + (bar.sheetOpen ? 'box-close' : 'box-open') + '" aria-expanded="' + (bar.sheetOpen ? 'true' : 'false') + '">'
      + '<span class="bxq-count-top">' + bar.items + (bar.items === 1 ? ' Item' : ' Items') + (bar.sheetOpen ? ICON_DOWN : ICON_UP) + (style === 'compact' ? '<i>·</i>' + esc(bar.total) : '') + '</span>';
    if (on(config, 'qs_bar_show_saved') && bar.saved && style !== 'compact') html += '<span class="bxq-saved">' + esc(bar.saved) + '</span>';
    else if (style !== 'compact') html += '<span class="bxq-total">' + esc(bar.total) + '</span>';
    html += '</button>';

    var label = bar.checkingOut ? 'Adding…' : opt(config, 'qs_btn_label');
    var checkoutBtn = cod.shown && codPlacement === 'replace' ? '' : '<button type="button" class="bxq-go" data-combo-action="checkout"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
    var codBtn = cod.shown ? '<button type="button" class="bxq-cod" data-combo-action="cod"' + (disabled ? ' disabled' : '') + (cod.css ? ' style="' + esc(cod.css) + '"' : '') + '>' + (cod.icon || '') + esc(cod.text || 'Cash on Delivery') + '</button>' : '';
    html += '<span class="bxq-actions' + (cod.shown ? ' has-cod' : '') + '">' + (codPlacement === 'below' ? checkoutBtn + codBtn : codBtn + checkoutBtn) + '</span>';
    html += '</div></div>';
    return html;
  }

  /* ── title, description, banner: the builder's shared Content / Banner settings ── */

  // A setting edited per device in the builder: <key>_mobile on phones, if set.
  function pick(config, key, isMobile) {
    if (isMobile) {
      var m = config[key + '_mobile'];
      if (m !== undefined && m !== null && m !== '') return m;
    }
    return config[key];
  }

  function isSet(v) { return v !== undefined && v !== null && v !== ''; }

  function boxCss(config, prefix, isMobile) {
    var parts = ['padding_top', 'padding_right', 'padding_bottom', 'padding_left', 'margin_top', 'margin_right', 'margin_bottom', 'margin_left'];
    var css = '';
    for (var i = 0; i < parts.length; i++) {
      var v = pick(config, prefix + '_' + parts[i], isMobile);
      if (isSet(v)) css += parts[i].replace('_', '-') + ':' + num(v, 0, -200, 400) + 'px;';
    }
    return css;
  }

  function textCss(config, prefix, isMobile, defaults) {
    var css = '';
    var align = pick(config, prefix + '_align', isMobile);
    css += 'text-align:' + (align === 'center' || align === 'right' ? align : 'left') + ';';
    var size = pick(config, prefix + '_size', isMobile);
    if (isSet(size)) css += 'font-size:' + num(size, defaults.size, 10, 96) + 'px;';
    var color = pick(config, prefix + '_color', isMobile);
    if (isSet(color)) css += 'color:' + safeCss(color, defaults.color) + ';';
    var weight = String(pick(config, prefix + '_font_weight', isMobile) || '');
    if (/^[1-9]00$/.test(weight)) css += 'font-weight:' + weight + ';';
    return css;
  }

  function renderHead(model) {
    var config = model.config;
    if (!on(config, 'qs_show_header') || config.show_title_description === false) return '';
    if (!model.title && !model.description) return '';
    var m = model.isMobile;
    var html = '<header class="bxq-head">';
    if (model.title) {
      var titleCss = textCss(config, 'heading', m, { size: m ? 22 : 28, color: 'inherit' });
      var family = String(config.heading_font_family || '');
      if (family && family !== 'inherit' && /^[\w -]{1,40}$/.test(family)) titleCss += "font-family:'" + family + "',sans-serif;";
      if (isSet(config.heading_letter_spacing)) titleCss += 'letter-spacing:' + num(config.heading_letter_spacing, 0, -10, 20) + 'px;';
      if (isSet(config.heading_line_height)) titleCss += 'line-height:' + num(config.heading_line_height, 1.2, 0.5, 3) + ';';
      var transform = config.heading_text_transform;
      if (transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize') titleCss += 'text-transform:' + transform + ';';
      var wrapCss = boxCss(config, 'title_container', m);
      if (config.title_max_width_mode === 'custom' && !m) {
        var align = pick(config, 'heading_align', m);
        wrapCss += 'max-width:' + num(config.title_max_width_custom, 400, 100, 2000) + 'px;'
          + (align === 'center' ? 'margin-left:auto;margin-right:auto;' : align === 'right' ? 'margin-left:auto;' : '');
      }
      html += '<div class="bxq-title-wrap" style="' + wrapCss + '"><h2 class="bxq-title" style="' + titleCss + '">' + esc(model.title) + '</h2></div>';
    }
    if (model.description) {
      html += '<div class="bxq-desc-wrap" style="' + boxCss(config, 'description_container', m) + '">'
        + '<p class="bxq-desc" style="' + textCss(config, 'description', m, { size: 15, color: 'inherit' }) + '">' + esc(model.description) + '</p></div>';
    }
    return html + '</header>';
  }

  // The Banner section's image (Layout tab): the phone image on phones if set.
  function renderBanner(model) {
    var config = model.config;
    if (config.show_banner === false) return '';
    var m = model.isMobile;
    var url = m && isIconUrl(config.banner_image_mobile_url) ? config.banner_image_mobile_url : config.banner_image_url;
    if (!isIconUrl(url)) return '';
    var fit = config.banner_fit_mode;
    var height = m ? num(config.banner_height_mobile || config.banner_height_desktop, 120, 40, 800) : num(config.banner_height_desktop, 180, 40, 1000);
    var width = m ? num(config.banner_width_mobile || config.banner_width_desktop, 100, 20, 100) : num(config.banner_width_desktop, 100, 20, 100);
    var boxCssText = 'width:' + (config.banner_full_width ? '100%' : width + '%') + ';'
      + (fit === 'adapt' ? '' : 'height:' + height + 'px;');
    var imgCss = fit === 'adapt' ? 'height:auto;' : 'height:100%;object-fit:' + (fit === 'contain' ? 'contain' : 'cover') + ';';
    return '<div class="bxq-banner' + (config.banner_full_width ? ' is-full' : '') + '" style="' + boxCssText + '">'
      + '<img src="' + esc(url) + '" alt="' + esc(model.title || 'Banner') + '" style="' + imgCss + '" /></div>';
  }

  /** The whole page as HTML (attributes data-combo-action drive it). */
  function render(model) {
    var config = model.config;
    var html = '<div class="bxq' + (model.isMobile ? ' bxq--m' : '') + '" style="' + vars(config) + '">';
    html += renderBanner(model);
    html += renderHead(model);
    html += renderTop(model);
    html += renderFilters(model);
    if (model.row.menus.length) {
      for (var i = 0; i < model.row.menus.length; i++) if (model.row.menus[i].open) html += '<div class="bxq-scrim" data-combo-action="qs-menu-close"></div>';
    }
    if (model.empty) html += '<div class="bxq-empty">' + esc(model.empty) + '</div>';
    else {
      html += '<div class="bxq-grid">';
      for (var c = 0; c < model.cards.length; c++) html += renderCard(model, model.cards[c]);
      html += '</div>';
    }
    html += renderBar(model);
    if (model.toast) html += '<div class="bxq-toast" role="status">' + esc(model.toast) + '</div>';
    html += '</div>';
    return html;
  }

  /**
   * Handles a Quick Shop UI action on ui (filters, menus, sheet). Returns true
   * when it was one; adding/removing items stays with the caller.
   */
  function applyUiAction(ui, action, el) {
    var value = el && el.getAttribute ? el.getAttribute('data-value') : null;
    var menu = el && el.getAttribute ? el.getAttribute('data-menu') : null;
    if (!ui.dd) ui.dd = {};
    if (action === 'qs-chip') { ui.chip = value === 'all' || value === ui.chip ? 'all' : value; ui.menu = null; return true; }
    if (action === 'qs-instock') { ui.instock = !ui.instock; ui.menu = null; return true; }
    if (action === 'qs-menu') { ui.menu = ui.menu === menu ? null : menu; return true; }
    if (action === 'qs-menu-close') { ui.menu = null; return true; }
    if (action === 'qs-pick') { ui.dd[menu] = value || ''; ui.menu = null; return true; }
    if (action === 'qs-clear') { ui.chip = 'all'; ui.instock = false; ui.dd = {}; ui.menu = null; return true; }
    if (action === 'box-open') { ui.sheetOpen = true; return true; }
    if (action === 'box-close') { ui.sheetOpen = false; return true; }
    return false;
  }

  return {
    DEFAULTS: DEFAULTS,
    SORTS: SORTS,
    opt: opt,
    on: on,
    offerText: offerText,
    labelledTiers: labelledTiers,
    filterRow: filterRow,
    filterProducts: filterProducts,
    canCheckout: canCheckout,
    barMessage: barMessage,
    buildModel: buildModel,
    render: render,
    applyUiAction: applyUiAction,
    ICON_NAMES: ICON_NAMES,
    TIER_ICON_ORDER: TIER_ICON_ORDER,
    iconName: iconName,
    svgIcon: svgIcon,
  };
}

/**
 * Styles of the Quick Shop template. One copy, used by the storefront script
 * (injected as text) and the builder preview. Colours and sizes come from the
 * --bxq-* variables the renderer sets from the merchant's qs_* settings;
 * .bxq--m is the phone layout (a class, not a media query, so the builder's
 * phone frame gets it too).
 */
export const QUICK_SHOP_CSS = `
.bxq{max-width:1280px;margin:0 auto;padding:16px 20px 24px;background:var(--bxq-page);color:var(--bxq-text);font-family:inherit;box-sizing:border-box;position:relative;}
.bxq *{box-sizing:border-box;}
.bxq button{font:inherit;color:inherit;}
.bxq--m{padding:10px 12px 20px;}
.bxq-head{margin:4px 0 14px;}
.bxq-title{margin:0;font-size:28px;line-height:1.2;font-weight:800;color:var(--bxq-text);}
.bxq--m .bxq-title{font-size:22px;}
.bxq-banner{margin:0 auto 16px;overflow:hidden;border-radius:var(--bxq-radius);}
.bxq-banner.is-full{border-radius:0;}
.bxq-banner img{display:block;width:100%;}
.bxq-desc{margin:6px 0 0;font-size:15px;line-height:1.5;opacity:.72;max-width:70ch;}
.bxq-top{background:var(--bxq-top-bg);color:var(--bxq-top-text);border-radius:16px;padding:14px 18px 16px;margin:0 0 14px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
.bxq-top.is-sticky{position:sticky;top:var(--bxq-top-offset);z-index:998;}
.bxq--m .bxq-top{padding:10px 12px 8px;border-radius:14px;}
.bxq--m .bxq-top.is-sticky .bxq-top-title{display:none;}
.bxq--m .bxq-top-msg{font-size:13.5px;margin:0 0 8px;}
.bxq-top-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.6;}
.bxq-top-msg{margin:4px 0 10px;font-size:15px;font-weight:700;line-height:1.4;}
.bxq-top-msg.is-success{color:var(--bxq-done);}
.bxq-top-msg.is-error{color:#b91c1c;}
.bxq-top--text .bxq-top-msg{margin-bottom:0;}
.bxq-track{position:relative;height:var(--bxq-top-h);background:var(--bxq-track);border-radius:var(--bxq-top-r);}
/* Fills and the scrim are empty divs: themes like Dawn hide div:empty, so force them on. */
.bxq-fill,.bxq-step-fill,.bxq-miles-fill,.bxq-slim-fill,.bxq-scrim{display:block!important;}
.bxq-fill{height:100%;background:var(--bxq-fill);border-radius:var(--bxq-top-r);transition:width .35s ease;}
.bxq-fill.is-done{background:var(--bxq-done);}
.bxq-tick{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;border:2px solid var(--bxq-track);}
.bxq-tick.is-hit{border-color:var(--bxq-done);background:var(--bxq-done);}
.bxq-ticks{position:relative;height:38px;margin-top:6px;}
.bxq-tick-label{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;white-space:nowrap;font-size:12px;line-height:1.3;}
.bxq-tick-label:last-child{transform:translateX(-100%);align-items:flex-end;}
.bxq-tick-label small,.bxq-step-label small,.bxq-mile-label small{opacity:.6;font-size:11px;}
.bxq-tick-label.is-hit b,.bxq-step.is-hit b,.bxq-mile.is-hit b{color:var(--bxq-done);}
.bxq-steps{display:flex;gap:6px;}
.bxq-step{flex:1;min-width:0;}
.bxq-step-track{height:var(--bxq-top-h);background:var(--bxq-track);border-radius:var(--bxq-top-r);overflow:hidden;}
.bxq-step-fill{height:100%;background:var(--bxq-fill);transition:width .35s ease;}
.bxq-step.is-hit .bxq-step-fill{background:var(--bxq-done);}
.bxq-step-label{display:flex;flex-direction:column;margin-top:6px;font-size:12px;line-height:1.3;}
.bxq-miles{position:relative;height:74px;margin:0 50px;}
.bxq--m .bxq-miles{margin:0 38px;}
.bxq-miles-line{position:absolute;left:0;right:0;top:17px;height:var(--bxq-top-h);margin-top:calc(var(--bxq-top-h) / -2);background:var(--bxq-track);border-radius:var(--bxq-top-r);}
.bxq-miles-fill{height:100%;background:var(--bxq-fill);border-radius:var(--bxq-top-r);transition:width .35s ease;}
.bxq-mile{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;width:110px;text-align:center;}
.bxq-mile-dot{width:34px;height:34px;border-radius:50%;background:#fff;border:2px solid var(--bxq-track);display:flex;align-items:center;justify-content:center;font-size:16px;transition:transform .25s ease;}
.bxq-mile.is-next .bxq-mile-dot{border-color:var(--bxq-fill);}
.bxq-mile.is-hit .bxq-mile-dot{background:var(--bxq-done);border-color:var(--bxq-done);}
.bxq-mile-icon{width:18px;height:18px;object-fit:contain;display:block;}
.bxq-mile-dot{color:#6b7280;}
.bxq-mile.is-next .bxq-mile-dot{color:var(--bxq-fill);}
.bxq-mile.is-hit .bxq-mile-dot{color:#fff;}
.bxq-msg-icon{color:#fff;}
.bxq-msg-glyph{width:22px;height:22px;display:block;object-fit:contain;}
.bxq-mile-label{display:flex;flex-direction:column;margin-top:4px;font-size:12px;line-height:1.25;}
.bxq--m .bxq-mile{width:84px;}
.bxq--m .bxq-mile-label{font-size:11px;}
.bxq-filters{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 14px;scrollbar-width:none;align-items:center;}
.bxq-filters::-webkit-scrollbar{display:none;}
.bxq-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;border:1.5px solid rgba(0,0,0,.12);background:#fff;border-radius:999px;padding:9px 18px;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--bxq-text) !important;}
.bxq--m .bxq-chip{padding:7px 13px;font-size:13.5px;}
.bxq-chip.is-on{border-color:var(--bxq-accent);background:color-mix(in srgb,var(--bxq-accent) 10%,#fff);color:var(--bxq-accent) !important;}
.bxq-chip--icon{padding:9px 14px;position:relative;}
.bxq-chip--icon.is-active::after{content:"";position:absolute;top:6px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--bxq-accent);}
.bxq-dd{position:relative;flex:0 0 auto;}
.bxq-menu{position:fixed;z-index:1001;margin-top:6px;min-width:200px;max-height:300px;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:6px;}
.bxq-opt{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:9px;padding:10px 12px;font-size:14px;cursor:pointer;}
.bxq-opt:hover{background:#f3f4f6;}
.bxq-opt.is-on{color:var(--bxq-accent) !important;font-weight:700;}
.bxq-scrim{position:fixed;inset:0;z-index:1000;}
.bxq-grid{display:grid;grid-template-columns:repeat(var(--bxq-cols),minmax(0,1fr));gap:18px;}
.bxq--m .bxq-grid{grid-template-columns:repeat(var(--bxq-cols-m),minmax(0,1fr));gap:10px;}
.bxq-card{background:var(--bxq-card);border-radius:var(--bxq-radius);padding:12px;display:flex;flex-direction:column;min-width:0;}
.bxq--m .bxq-card{padding:8px;}
.bxq-card.is-out .bxq-media img{opacity:.5;}
.bxq-media{position:relative;aspect-ratio:var(--bxq-ratio);border-radius:calc(var(--bxq-radius) - 2px);overflow:hidden;background:#fff;}
.bxq-media img{width:100%;height:100%;object-fit:contain;display:block;}
.bxq-noimg{display:block;width:100%;height:100%;background:#eef0f3;}
.bxq-badge{position:absolute;left:0;right:0;bottom:0;padding:16px 10px 6px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(180deg,transparent,var(--bxq-badge) 70%);}
.bxq-add{position:absolute;top:8px;right:8px;width:44px;height:44px;border-radius:12px;border:2px solid var(--bxq-accent);background:#fff;color:var(--bxq-accent) !important;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.08);}
.bxq-add:hover{background:color-mix(in srgb,var(--bxq-accent) 8%,#fff);}
.bxq--m .bxq-add{width:36px;height:36px;border-radius:10px;}
.bxq-stepper{position:absolute;top:8px;right:8px;display:flex;align-items:center;background:var(--bxq-accent);color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.15);}
.bxq-stepper button{border:0;background:transparent;color:#fff !important;width:36px;height:40px;font-size:20px;font-weight:700;cursor:pointer;}
.bxq-stepper span{min-width:22px;text-align:center;font-weight:800;}
.bxq--m .bxq-stepper button{width:30px;height:34px;}
.bxq-soldout{position:absolute;top:8px;right:8px;background:rgba(17,24,39,.8);color:#fff;font-size:12px;font-weight:700;border-radius:8px;padding:5px 8px;}
.bxq-info{display:flex;flex-direction:column;gap:6px;padding:10px 2px 2px;flex:1;}
.bxq-eyebrow{font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;opacity:.6;}
.bxq-name{margin:0;font-size:17px;line-height:1.3;font-weight:600;color:var(--bxq-text);}
.bxq--m .bxq-name{font-size:14px;}
.bxq-sub{margin:0;font-size:14px;line-height:1.4;opacity:.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bxq--m .bxq-sub{font-size:12.5px;}
.bxq-variant{position:relative;display:inline-flex;align-items:center;gap:4px;color:var(--bxq-accent);font-size:15px;align-self:flex-start;margin-top:4px;}
.bxq-variant select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:var(--bxq-text);padding:2px 20px 2px 0;cursor:pointer;max-width:100%;}
.bxq-variant svg{position:absolute;right:0;pointer-events:none;}
.bxq-variant.is-static{color:var(--bxq-text);opacity:.75;}
.bxq-off{display:flex;align-items:center;gap:8px;color:var(--bxq-off);font-size:15px;font-weight:800;}
.bxq-off::after{content:"";flex:1;border-top:1.5px dashed rgba(0,0,0,.15);}
.bxq-price{display:flex;align-items:baseline;gap:8px;}
.bxq-price b{font-size:19px;font-weight:800;}
.bxq-price s{font-size:14px;opacity:.45;}
.bxq--m .bxq-price b{font-size:16px;}
.bxq-nocount{font-size:12px;opacity:.55;}
.bxq-empty{padding:40px 16px;text-align:center;opacity:.65;font-size:15px;background:var(--bxq-card);border-radius:var(--bxq-radius);}
.bxq-bar{position:sticky;bottom:12px;z-index:999;margin:18px auto 0;max-width:980px;background:var(--bxq-bar-bg);color:var(--bxq-bar-text);border-radius:var(--bxq-bar-r);box-shadow:0 -2px 24px rgba(0,0,0,.14);padding:12px 16px;overflow:hidden;}
.bxq--m .bxq-bar{bottom:8px;padding:10px 12px;}
.bxq-slim{height:4px;margin:-12px -16px 10px;background:rgba(0,0,0,.08);}
.bxq-slim-fill{height:100%;background:var(--bxq-fill);transition:width .35s ease;}
.bxq-slim-fill.is-done{background:var(--bxq-done);}
.bxq-msg{display:flex;align-items:center;gap:12px;font-size:16px;padding:0 0 10px;margin:0 0 10px;border-bottom:1px solid rgba(0,0,0,.1);}
.bxq--m .bxq-msg{font-size:14px;}
.bxq-msg.is-error{color:#b91c1c;}
.bxq-msg b{font-weight:800;}
.bxq-msg-icon{width:42px;height:42px;flex:0 0 auto;border-radius:50%;background:var(--bxq-icon-bg);display:flex;align-items:center;justify-content:center;font-size:22px;}
.bxq-msg-glyph{width:26px;height:26px;object-fit:contain;line-height:26px;text-align:center;}
.bxq-bar.is-celebrate .bxq-msg-icon{animation:bxq-pop .7s ease;}
.bxq-bar.is-celebrate .bxq-msg{animation:bxq-glow 1.2s ease;}
@keyframes bxq-pop{0%{transform:scale(.6) rotate(-12deg);}55%{transform:scale(1.25) rotate(8deg);}100%{transform:none;}}
@keyframes bxq-glow{0%,100%{background:transparent;}30%{background:color-mix(in srgb,var(--bxq-save) 14%,transparent);}}
.bxq-row{display:flex;align-items:center;gap:12px;}
.bxq-thumbs{display:flex;flex:0 0 auto;}
.bxq-thumbs img{width:46px;height:46px;border-radius:12px;object-fit:cover;background:#fff;border:2px solid var(--bxq-bar-bg);margin-left:-26px;box-shadow:0 1px 4px rgba(0,0,0,.12);position:relative;}
.bxq-thumbs img:first-child{margin-left:0;}
.bxq--m .bxq-thumbs img{width:40px;height:40px;margin-left:-24px;}
.bxq--m .bxq-thumbs img:first-child{margin-left:0;}
.bxq-count{border:0;background:transparent;padding:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;cursor:pointer;min-width:0;flex:1;text-align:left;color:var(--bxq-bar-text) !important;}
.bxq-count-top{display:inline-flex;align-items:center;gap:4px;font-size:17px;font-weight:700;white-space:nowrap;}
.bxq-count-top svg{color:var(--bxq-accent);}
.bxq-count-top i{font-style:normal;opacity:.5;margin:0 2px;}
.bxq--m .bxq-count-top{font-size:15px;}
.bxq-saved{font-size:14px;font-weight:700;color:var(--bxq-save);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.bxq-total{font-size:14px;font-weight:700;opacity:.75;}
.bxq-actions{display:flex;gap:8px;flex:0 0 auto;}
.bxq-go,.bxq-cod{border:0;border-radius:var(--bxq-btn-r);padding:14px 26px;font-size:17px;font-weight:800;cursor:pointer;white-space:nowrap;}
.bxq-go{background:var(--bxq-btn);color:var(--bxq-btn-text) !important;}
.bxq-cod{background:#fff;border:1.5px solid var(--bxq-btn);color:var(--bxq-btn);display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.bxq--m .bxq-row{flex-wrap:wrap;}
.bxq--m .bxq-actions.has-cod{flex:1 1 100%;}
.bxq--m .bxq-actions.has-cod button{flex:1;}
.bxq--m .bxq-go,.bxq--m .bxq-cod{padding:12px 16px;font-size:15px;}
.bxq-go:disabled,.bxq-cod:disabled{opacity:.45;cursor:not-allowed;}
.bxq-ring{position:relative;width:44px;height:44px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;}
.bxq-ring svg{position:absolute;inset:0;transform:rotate(-90deg);}
.bxq-ring-bg{fill:none;stroke:rgba(0,0,0,.1);stroke-width:4;}
.bxq-ring-fg{fill:none;stroke:var(--bxq-fill);stroke-width:4;stroke-linecap:round;transition:stroke-dashoffset .35s ease;}
.bxq-ring.is-done .bxq-ring-fg{stroke:var(--bxq-done);}
.bxq-ring b{font-size:15px;position:relative;}
.bxq-sheet{max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:2px 0 12px;margin-bottom:10px;border-bottom:1px solid rgba(0,0,0,.1);}
.bxq-line{display:flex;align-items:center;gap:10px;}
.bxq-line img,.bxq-line .bxq-noimg{width:44px;height:44px;border-radius:10px;object-fit:cover;flex:0 0 auto;}
.bxq-line-main{flex:1;min-width:0;}
.bxq-line-name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bxq-line-sub{font-size:12px;opacity:.6;}
.bxq-line-price{font-size:14px;font-weight:700;min-width:64px;text-align:right;}
.bxq-mini{display:flex;align-items:center;border:1.5px solid var(--bxq-accent);border-radius:9px;color:var(--bxq-accent);}
.bxq-mini button{border:0;background:transparent;width:28px;height:28px;font-size:16px;font-weight:700;cursor:pointer;color:var(--bxq-accent) !important;}
.bxq-mini span{min-width:18px;text-align:center;font-size:13px;font-weight:800;}
.bxq-clear{align-self:flex-start;border:0;background:transparent;padding:0;font-size:13px;text-decoration:underline;opacity:.6;cursor:pointer;}
.bxq-toast{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:10000;background:#111827;color:#fff;border-radius:12px;padding:10px 16px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:90vw;}
@media (prefers-reduced-motion: reduce){.bxq-fill,.bxq-step-fill,.bxq-miles-fill,.bxq-slim-fill,.bxq-ring-fg{transition:none;}.bxq-bar.is-celebrate .bxq-msg-icon,.bxq-bar.is-celebrate .bxq-msg{animation:none;}}
`;
