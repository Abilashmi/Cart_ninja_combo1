/**
 * Combo pages: the box templates (Quantity Box layout7, Weight Box layout5,
 * Value Box layout6, which was "Quick Shop") — one copy of their filters,
 * card data, progress and HTML. Cards: quick add (+ on the image) or normal
 * (Add button under the price), qs_card_layout.
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
    // Collection chips drawn as pictures with the name under them (a bar the
    // shopper swipes to switch collections). Picture: qs_chip_images[handle]
    // (https link), else the collection's Shopify image, else its first
    // product's image.
    qs_chip_style: 'text', // text | images
    qs_chip_image_size: 64, // px on desktop; phones get 80% of it
    qs_chip_image_shape: 'circle', // circle | rounded | square
    qs_chip_images: null, // { [collection handle]: 'https://…' }
    // The merchant's own name for a collection on the page (chips, picture
    // bar, section headings); missing / empty = the Shopify collection name.
    qs_col_titles: null, // { [collection handle]: 'Tees' }
    qs_chips_align: 'left', // left | center | right: the chip row and the picture bar
    // Products in one section per collection (in the Box Collections order)
    // under its name, instead of one mixed grid. A product in two collections
    // shows in the first. Products added under "Products on the page" come
    // last, under qs_extra_title (empty = no heading).
    qs_group_by_collection: false,
    qs_group_title_align: 'left', // left | center | right
    qs_group_title_size: null, // px; null = 20 (phones 17)
    qs_group_title_size_m: null,
    qs_extra_title: '',
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
    // Collection filter groups: each group is one filter ("Weight", "Years")
    // whose options are store collections (any collection, not only the
    // page's), shown as a dropdown or a chip row; one option per group.
    // [{ id, label, style: 'dropdown' | 'chips', options: [{ handle, label }] }]
    // (option label '' = the collection's title). See filterGroups().
    qs_filter_groups: null,
    // Weight filter, from the products' own Shopify variant weights (no
    // collections needed). auto = one option per weight on the page (250 g,
    // 500 g, 1 kg); ranges = qs_filter_weight_ranges [{ min, max, label }] in
    // grams, min included, max not (null = and above); slider = the shopper
    // drags from–to between the lightest and heaviest. See weightFilter().
    qs_filter_weight: false,
    qs_filter_weight_label: 'Weight',
    qs_filter_weight_mode: 'auto', // auto | ranges | slider
    qs_filter_weight_ranges: null,
    qs_filter_weight_style: 'dropdown', // dropdown | chips (auto and ranges)
    // Price slider: from–to between the cheapest and dearest variant on the page.
    qs_filter_price: false,
    qs_filter_price_label: 'Price',
    // Sliders as their own row, or behind a chip like the dropdowns.
    qs_slider_look: 'row', // row | dropdown
    // Desktop: filters above the products, or in a column on the left
    // (phones always above).
    qs_filter_position: 'top', // top | left
    qs_filter_font_size: null, // px; null = as before (15, phones 13.5)
    qs_filter_font_size_m: null,
    // Cards
    // quick_add = + button on the image that turns into a stepper; normal =
    // a full-width Add button under the price (stepper there once added).
    qs_card_layout: 'quick_add', // quick_add | normal
    qs_add_label: 'Add',
    // Prices as whole amounts (₹1,708 not ₹1,708.20): display only, checkout
    // charges the exact price.
    qs_hide_decimals: false,
    // A tap on a card's picture or name opens the product in a popup: its
    // pictures with thumbnails, full description, options and Add.
    qs_product_popup: true,
    // Card text sizes (px); null = as before. Phones have their own.
    qs_card_title_size: null, // 17, phones 14
    qs_card_title_size_m: null,
    qs_card_text_size: null, // subtitle, option / weight, % OFF (14-15, phones 12.5-15)
    qs_card_text_size_m: null,
    qs_card_price_size: null, // 19, phones 16
    qs_card_price_size_m: null,
    qs_columns_desktop: 4,
    qs_columns_mobile: 2,
    qs_card_eyebrow: '',
    qs_show_subtitle: true,
    qs_show_compare: true,
    qs_show_price: true, // the card's selling price (the popup always shows it)
    // Most of one product a shopper can put in the box, all its variants
    // together (null / 0 = no limit); + stops there and the text says why.
    qs_max_per_product: null,
    qs_max_per_product_text: 'You can add up to {{max}} of each product.',
    // Cards drawn at once; "Show more" adds the next lot. Filters always
    // search every product of the page, not just the cards drawn.
    qs_page_size: 40,
    qs_more_text: 'Show more',
    qs_show_off: true,
    qs_show_weight: true,
    qs_badge_tag: 'bestseller',
    qs_badge_text: 'Bestseller',
    qs_image_ratio: 'square', // square | portrait (4:5) | tall (2:3) | landscape
    // contain = the whole picture (bands where its shape differs from the
    // frame); cover = fills the frame, trimming the edges.
    qs_image_fit: 'contain',
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
    // What the text under the bar shows and how big (bar, steps, milestones).
    qs_top_show_name: true, // the offer name ("10% OFF")
    qs_top_show_amount: true, // what's needed for it ("₹999", "2 kg", "3 items")
    qs_top_label_size: 12, // px
    qs_top_label_size_m: null, // phones; null = as before (milestones 1px smaller)
    qs_top_sub_size: 11, // the amount line, px
    qs_top_height: 8,
    qs_top_radius: 999,
    // Milestone icon size (px); its circle is 16px bigger. Phones: null = the
    // desktop size. Many tiers on a narrow page shrink both (mileSizes).
    qs_mile_icon_size: 18,
    qs_mile_icon_size_m: null,
    qs_top_bg: '#ffffff',
    qs_top_text: '#111827',
    qs_top_track: '#e5e7eb',
    qs_top_fill: '#2563eb',
    qs_top_done: '#16a34a',
    qs_tier_icons: 'gift, truck, percent, star, trophy', // built-in SVG icon names (ICONS) or https:// image links
    // Bottom bar
    qs_bar_style: 'full', // full | slim | ring | compact | slots (quantity boxes: one box per item of the next offer)
    qs_bar_bg: '#ffffff',
    qs_bar_text: '#111827',
    qs_bar_save: '#16a34a',
    qs_bar_radius: 20,
    qs_bar_show_message: true,
    qs_bar_show_thumbs: true,
    qs_bar_show_saved: true,
    qs_sheet_show_price: true, // each line's price in the box list the bottom bar opens
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
    // Go to Cart button size (padding also applies to the COD button beside
    // it; COD's text size is set under COD → Customize → Combo page button).
    qs_btn_font_size: null, // px; null = the theme's text size, as before this setting
    qs_btn_font_size_m: 15,
    qs_btn_pad_y: 14, // phones: 2px less
    qs_btn_pad_x: 26, // phones: at most 16
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

  /** A collection's name on the page: the merchant's own, else Shopify's. */
  function collectionTitle(config, handle, collectionNames) {
    var own = opt(config, 'qs_col_titles');
    var mine = own && typeof own === 'object' ? String(own[handle] || '').trim().slice(0, 60) : '';
    return mine || (collectionNames && collectionNames[handle]) || handle;
  }

  function sideOf(config, key) {
    var a = opt(config, key);
    return a === 'center' || a === 'right' ? a : 'left';
  }

  /* ── most of one product per box (qs_max_per_product) ──────────────── */

  /** The limit (1-99), or 0 = none. */
  function maxPerProduct(config) {
    var n = Math.floor(Number(opt(config, 'qs_max_per_product')));
    return isFinite(n) && n > 0 ? Math.min(n, 99) : 0;
  }

  /** Cards per "Show more" step (12-200, default 40). */
  function pageSize(config) {
    var n = Math.floor(Number(opt(config, 'qs_page_size')));
    return isFinite(n) && n > 0 ? Math.max(12, Math.min(n, 200)) : DEFAULTS.qs_page_size;
  }

  // What the shopper has filtered by: "Show more" counts only while it stays
  // the same, so a new filter starts again from the first cards.
  function filterKey(ui) {
    var dd = ui && ui.dd ? ui.dd : {};
    var keys = [];
    for (var k in dd) if (Object.prototype.hasOwnProperty.call(dd, k) && dd[k]) keys.push(k + '=' + dd[k]);
    keys.sort();
    return String((ui && ui.chip) || 'all') + '|' + (ui && ui.instock ? 1 : 0) + '|' + keys.join('&');
  }

  /** How many of a product the box holds, all its variants together. selection = { variantId: { productId, qty } }. */
  function productQty(selection, productId) {
    var total = 0;
    for (var vid in selection) {
      if (!Object.prototype.hasOwnProperty.call(selection, vid)) continue;
      var sel = selection[vid];
      if (sel && String(sel.productId) === String(productId)) total += Number(sel.qty) || 0;
    }
    return total;
  }

  /**
   * '' when the box may hold `next` (the selection after the change) as far
   * as the per-product limit goes, else the message to show. Only a product
   * that grew is checked, so taking one out is always allowed.
   */
  function productLimitMessage(config, selection, next) {
    var max = maxPerProduct(config);
    if (!max) return '';
    var seen = {};
    for (var vid in next) {
      if (!Object.prototype.hasOwnProperty.call(next, vid)) continue;
      var pid = String(next[vid] && next[vid].productId);
      if (seen[pid]) continue;
      seen[pid] = true;
      var after = productQty(next, pid);
      if (after > max && after > productQty(selection || {}, pid)) {
        return String(opt(config, 'qs_max_per_product_text') || DEFAULTS.qs_max_per_product_text).replace(/\{\{\s*max\s*\}\}/g, String(max));
      }
    }
    return '';
  }

  // qs_hide_decimals of the template being built/rendered (set by
  // buildModel and render, which always run with one config at a time).
  var wholeMoney = false;

  function money(amount, symbol) {
    var n = Math.max(0, Number(amount) || 0);
    var text = wholeMoney || Math.round(n * 100) % 100 === 0 ? String(Math.round(n)) : n.toFixed(2);
    return (symbol || '') + text;
  }

  // An amount in minor units for "Add ₹X more" with decimals hidden: rounded
  // up to whole rupees for what's still needed (so adding it is enough),
  // rounded for everything else. Other measures are untouched.
  function wholeMinor(view, amount, decimals, roundUp) {
    if (!wholeMoney || !view || view.measure !== 'value') return amount;
    var unit = Math.pow(10, decimals === undefined ? 2 : decimals);
    return (roundUp ? Math.ceil(Number(amount) / unit - 1e-9) : Math.round(Number(amount) / unit)) * unit;
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

  /** "10% OFF" / "₹100 OFF" / "Any 2 for ₹999" / "Box at ₹499": what a tier gives, for the page. */
  function offerText(tier, symbol, measure) {
    if (tier.label) return tier.label;
    if (tier.type === 'percentage') return tier.value + '% OFF';
    if (tier.type === 'fixed_amount') return money(tier.value, symbol) + ' OFF';
    if (tier.type === 'unit_price') return money(tier.value, symbol) + (measure === 'quantity' ? ' EACH' : '/KG');
    if (measure === 'quantity') return 'Any ' + tier.min_grams + ' for ' + money(tier.value, symbol);
    return 'Box at ' + money(tier.value, symbol);
  }

  /** The tiers with their page labels (merchant label, else the offer). */
  function labelledTiers(tiers, symbol, measure) {
    var out = [];
    for (var i = 0; i < (tiers || []).length; i++) {
      var t = tiers[i];
      out.push({ id: t.id, min_grams: t.min_grams, type: t.type, value: t.value, label: offerText(t, symbol, measure) });
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

  // The shopper's pick, else the first in-stock variant (variants[0] is often
  // a sold-out size), else the first one (the card then shows Out of stock).
  // prefer (optional): a variant test, e.g. the weight the shopper filtered
  // by, so a "1 kg" filter shows (and adds) each product's 1 kg variant.
  function activeVariant(product, pending, prefer) {
    var variants = product.variants || [];
    var id = pending && pending[product.id];
    var i;
    for (i = 0; i < variants.length; i++) if (id && String(variants[i].id) === String(id)) return variants[i];
    if (prefer) for (i = 0; i < variants.length; i++) if (variants[i].available !== false && prefer(variants[i], product)) return variants[i];
    for (i = 0; i < variants.length; i++) if (variants[i].available !== false) return variants[i];
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
  function httpsUrl(value) {
    var s = String(value || '').trim();
    return /^https:\/\/[^\s"'<>()\\]{1,500}$/.test(s) ? s : '';
  }

  // A collection chip's picture: the merchant's own link, the collection's
  // Shopify image, else its first product's image ('' = none).
  function collectionImage(config, handle, collectionImages, productsByHandle) {
    var own = opt(config, 'qs_chip_images');
    if (own && typeof own === 'object' && httpsUrl(own[handle])) return httpsUrl(own[handle]);
    if (collectionImages && httpsUrl(collectionImages[handle])) return httpsUrl(collectionImages[handle]);
    var prods = (productsByHandle && productsByHandle[handle]) || [];
    for (var i = 0; i < prods.length; i++) {
      var img = prods[i].image && (prods[i].image.url || prods[i].image.src);
      if (httpsUrl(img)) return httpsUrl(img);
    }
    return '';
  }

  var GROUP_MAX = 5;
  var GROUP_OPTION_MAX = 15;

  function cleanText(value, max) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // A collection handle as Shopify makes them (no spaces, quotes or markup).
  function cleanHandle(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    return /^[^\s"'<>&\\]{1,255}$/.test(s) ? s : '';
  }

  /**
   * The merchant's collection filter groups, checked: at most 5 groups of 15
   * collections, no repeated collection inside a group, no group without a
   * name or a collection.
   */
  function filterGroups(config) {
    var raw = opt(config, 'qs_filter_groups');
    var out = [];
    if (!raw || typeof raw.length !== 'number') return out;
    var ids = {};
    for (var g = 0; g < raw.length && out.length < GROUP_MAX; g++) {
      var group = raw[g];
      if (!group || typeof group !== 'object') continue;
      var label = cleanText(group.label, 40);
      var options = [];
      var seen = {};
      var rawOptions = group.options && typeof group.options.length === 'number' ? group.options : [];
      for (var o = 0; o < rawOptions.length && options.length < GROUP_OPTION_MAX; o++) {
        var handle = cleanHandle(rawOptions[o] && rawOptions[o].handle);
        if (!handle || seen[handle]) continue;
        seen[handle] = true;
        options.push({ handle: handle, label: cleanText(rawOptions[o].label, 40) });
      }
      if (!label || !options.length) continue;
      var id = /^[A-Za-z0-9_-]{1,32}$/.test(String(group.id || '')) && !ids['g' + group.id] ? String(group.id) : 'g' + g;
      ids['g' + id] = true;
      out.push({ id: id, label: label, style: group.style === 'chips' ? 'chips' : 'dropdown', options: options });
    }
    return out;
  }

  var WEIGHT_RANGE_MAX = 8;
  var WEIGHT_AUTO_MAX = 20;

  function weightText(grams) {
    return core.formatWeight(grams, grams < 1000 ? 'g' : 'kg');
  }

  /** The merchant's weight ranges, checked (grams; unnamed ranges get a name). */
  function weightRanges(config) {
    var raw = opt(config, 'qs_filter_weight_ranges');
    var out = [];
    if (!raw || typeof raw.length !== 'number') return out;
    for (var i = 0; i < raw.length && out.length < WEIGHT_RANGE_MAX; i++) {
      var r = raw[i];
      if (!r || typeof r !== 'object') continue;
      var min = Number(r.min);
      if (!isFinite(min) || min < 0) min = 0;
      var max = r.max === null || r.max === undefined || r.max === '' ? null : Number(r.max);
      if (max !== null && (!isFinite(max) || max <= min)) continue;
      if (min === 0 && max === null) continue;
      var label = cleanText(r.label, 40)
        || (max === null ? weightText(min) + '+' : min === 0 ? 'Under ' + weightText(max) : weightText(min) + ' – ' + weightText(max));
      out.push({ min: min, max: max, label: label });
    }
    return out;
  }

  /** The weight filter's settings, or null when it's off (or has no valid range). */
  function weightFilter(config) {
    if (!on(config, 'qs_filter_weight')) return null;
    var mode = opt(config, 'qs_filter_weight_mode');
    if (mode !== 'ranges' && mode !== 'slider') mode = 'auto';
    var spec = {
      label: cleanText(opt(config, 'qs_filter_weight_label'), 40) || 'Weight',
      style: opt(config, 'qs_filter_weight_style') === 'chips' ? 'chips' : 'dropdown',
      mode: mode,
      ranges: mode === 'ranges' ? weightRanges(config) : [],
    };
    return mode === 'ranges' && !spec.ranges.length ? null : spec;
  }

  /* Sliders (weight, price): the picked span is 's:<from>-<to>', both included. */

  function parseSpan(value) {
    var m = /^s:(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(String(value || ''));
    return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
  }

  function inSpan(value, n) {
    var span = parseSpan(value);
    return !!span && n >= span.lo && n <= span.hi;
  }

  // About 100 stops or fewer between the ends, on round numbers.
  function niceStep(span) {
    var steps = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= 100) return steps[i];
    return 10000;
  }

  // A slider from the smallest to the largest of values (null when they're all the same).
  function sliderGroup(id, label, kind, values, picked, symbol) {
    var lowest = Infinity;
    var highest = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (values[i] < lowest) lowest = values[i];
      if (values[i] > highest) highest = values[i];
    }
    if (!(highest > lowest)) return null;
    var step = niceStep(highest - lowest);
    var min = Math.floor(lowest / step) * step;
    var max = Math.ceil(highest / step) * step;
    var span = parseSpan(picked);
    var lo = span ? Math.max(min, Math.min(max, span.lo)) : min;
    var hi = span ? Math.max(lo, Math.min(max, span.hi)) : max;
    return {
      id: id, kind: 'slider', unit: kind, label: label, style: 'slider', value: picked || '',
      min: min, max: max, step: step, lo: lo, hi: hi, text: spanText(kind, lo, hi, symbol), symbol: symbol || '',
    };
  }

  function spanText(kind, lo, hi, symbol) {
    var f = function (n) { return kind === 'price' ? money(n, symbol) : weightText(n); };
    return f(lo) + ' – ' + f(hi);
  }

  function productFitsPrice(value, product) {
    var variants = product.variants || [];
    if (!variants.length) return inSpan(value, priceOf(product, null));
    for (var i = 0; i < variants.length; i++) if (inSpan(value, priceOf(product, variants[i]))) return true;
    return false;
  }

  function priceGroup(label, products, ui, symbol) {
    var prices = [];
    for (var p = 0; p < products.length; p++) {
      var variants = products[p].variants || [];
      if (!variants.length) prices.push(priceOf(products[p], null));
      for (var i = 0; i < variants.length; i++) prices.push(priceOf(products[p], variants[i]));
    }
    return sliderGroup('price', label, 'price', prices, (ui.dd && ui.dd.price) || '', symbol);
  }

  // Does a weight (grams) fit the picked option ('w:<grams>', 'r:<range index>' or 's:<from>-<to>')?
  function weightFits(spec, value, grams) {
    if (!value || !(grams > 0)) return false;
    if (value.indexOf('s:') === 0) return inSpan(value, grams);
    if (value.indexOf('w:') === 0) return Math.round(grams) === Number(value.slice(2));
    if (value.indexOf('r:') === 0) {
      var r = spec.ranges[Number(value.slice(2))];
      return !!r && grams >= r.min && (r.max === null || grams < r.max);
    }
    return false;
  }

  // A pick this filter understands (an old or broken one, e.g. a range after
  // the merchant switched to sliders, filters nothing instead of everything).
  function weightValueOk(spec, value) {
    if (/^w:\d+$/.test(value)) return true;
    if (/^r:\d+$/.test(value)) return !!spec.ranges[Number(value.slice(2))];
    return !!parseSpan(value);
  }

  function productFitsWeight(spec, value, product) {
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) if (weightFits(spec, value, variants[i].grams)) return true;
    return false;
  }

  // The weight filter as a group (same shape as the collection groups):
  // auto lists the weights on the page (needs two), ranges the ranges with
  // products in them; the picked option always stays.
  function weightGroup(spec, products, ui) {
    var value = (ui.dd && ui.dd.weight) || '';
    var options = [];
    var i;
    var p;
    if (spec.mode === 'slider') {
      var all = [];
      for (p = 0; p < products.length; p++) {
        for (i = 0; i < (products[p].variants || []).length; i++) {
          var grams = Number(products[p].variants[i].grams);
          if (grams > 0) all.push(grams);
        }
      }
      return sliderGroup('weight', spec.label, 'weight', all, value);
    }
    if (spec.mode === 'auto') {
      var weights = [];
      for (p = 0; p < products.length; p++) {
        var variants = products[p].variants || [];
        for (i = 0; i < variants.length; i++) {
          var g = Math.round(Number(variants[i].grams));
          if (g > 0 && weights.indexOf(g) === -1) weights.push(g);
        }
      }
      weights.sort(function (a, b) { return a - b; });
      weights = weights.slice(0, WEIGHT_AUTO_MAX);
      var picked = value.indexOf('w:') === 0 ? Number(value.slice(2)) : 0;
      if (picked > 0 && weights.indexOf(picked) === -1) { weights.push(picked); weights.sort(function (a, b) { return a - b; }); }
      if (weights.length < 2) return null;
      for (i = 0; i < weights.length; i++) options.push({ value: 'w:' + weights[i], label: weightText(weights[i]), on: value === 'w:' + weights[i] });
    } else {
      for (i = 0; i < spec.ranges.length; i++) {
        var key = 'r:' + i;
        var present = value === key;
        for (p = 0; !present && p < products.length; p++) if (productFitsWeight(spec, key, products[p])) present = true;
        if (present) options.push({ value: key, label: spec.ranges[i].label, on: value === key });
      }
      if (!options.length) return null;
    }
    return { id: 'weight', label: spec.label, style: spec.style, value: value, options: options, open: ui.menu === 'weight' };
  }

  // Products added to the page beyond its collections (weight_pricing.qualify
  // .extra_product_ids, loaded by the server) arrive under this handle.
  var EXTRA_HANDLE = '__brix_extra';

  /**
   * What the merchant left off the page: products (box_hide_product_ids) and
   * every product also in a collection (box_hide_collections [{ id, handle, title }]).
   */
  function pageExclusions(config) {
    var ids = {};
    var raw = (config && config.box_hide_product_ids) || [];
    for (var i = 0; i < raw.length && i < 200; i++) if (typeof raw[i] === 'string') ids[raw[i]] = true;
    var handles = [];
    var cols = (config && config.box_hide_collections) || [];
    for (var c = 0; c < cols.length && c < 20; c++) {
      var h = cleanHandle(cols[c] && cols[c].handle);
      if (h && handles.indexOf(h) === -1) handles.push(h);
    }
    return { productIds: ids, collectionHandles: handles };
  }

  /** Collections whose page products the server looks up: filter groups + hidden collections. */
  function memberHandles(config) {
    var out = filterGroupHandles(config);
    var hidden = pageExclusions(config).collectionHandles;
    for (var i = 0; i < hidden.length; i++) if (out.indexOf(hidden[i]) === -1) out.push(hidden[i]);
    return out;
  }

  /** Every collection the filter groups use (the server loads which page products are in them). */
  function filterGroupHandles(config) {
    var groups = filterGroups(config);
    var out = [];
    for (var g = 0; g < groups.length; g++) {
      for (var o = 0; o < groups[g].options.length; o++) if (out.indexOf(groups[g].options[o].handle) === -1) out.push(groups[g].options[o].handle);
    }
    return out;
  }

  /**
   * { [handle]: { [productId]: true } } for the groups' collections: what the
   * server found (collectionMembers = { handle: [productId] }) plus the
   * page's own collections. A handle with neither is left out = not known
   * yet (the builder before its fetch): its option shows and doesn't filter.
   */
  function groupMembers(groups, collectionMembers, productsByHandle) {
    var out = {};
    for (var g = 0; g < groups.length; g++) {
      for (var o = 0; o < groups[g].options.length; o++) {
        var h = groups[g].options[o].handle;
        if (out[h]) continue;
        var ids = collectionMembers && collectionMembers[h];
        var page = productsByHandle && productsByHandle[h];
        if (!ids && !page) continue;
        var set = {};
        var i;
        for (i = 0; ids && i < ids.length; i++) set[ids[i]] = true;
        for (i = 0; page && i < page.length; i++) set[page[i].id] = true;
        out[h] = set;
      }
    }
    return out;
  }

  // The groups with the options that have products on the page (the picked
  // one always stays, so the shopper can see and change it).
  function groupFilters(groups, members, products, collectionNames, ui) {
    var dd = ui.dd || {};
    var out = [];
    for (var g = 0; g < groups.length; g++) {
      var key = 'g:' + groups[g].id;
      var value = dd[key] || '';
      var options = [];
      for (var o = 0; o < groups[g].options.length; o++) {
        var opt0 = groups[g].options[o];
        var set = members[opt0.handle];
        var present = !set || value === opt0.handle;
        for (var p = 0; !present && p < products.length; p++) if (set[products[p].id]) present = true;
        if (!present) continue;
        options.push({ value: opt0.handle, label: opt0.label || (collectionNames && collectionNames[opt0.handle]) || opt0.handle, on: value === opt0.handle });
      }
      if (!options.length) continue;
      out.push({ id: key, label: groups[g].label, style: groups[g].style, value: value, options: options, open: ui.menu === key });
    }
    return out;
  }

  /**
   * groupInfo (optional) = { groups, members } from filterGroups() /
   * groupMembers(): dropdown groups join the menus, chip groups come back
   * as row.groups.
   */
  function filterRow(config, products, handles, collectionNames, ui, collectionImages, productsByHandle, groupInfo) {
    var chips = [];
    var source = opt(config, 'qs_chips_source');
    var chipValues = [];
    var pictures = opt(config, 'qs_chip_style') === 'images';
    if (source === 'collections' && handles.length > 1) {
      for (var h = 0; h < handles.length; h++) {
        var chip = { value: 'c:' + handles[h], label: collectionTitle(config, handles[h], collectionNames) };
        if (pictures) { chip.picture = true; chip.image = collectionImage(config, handles[h], collectionImages, productsByHandle); }
        chipValues.push(chip);
      }
    } else if (source === 'tags') {
      var tags = list(opt(config, 'qs_chip_tags'));
      for (var t = 0; t < tags.length; t++) chipValues.push({ value: 't:' + tags[t], label: tags[t] });
    }
    if (chipValues.length) {
      if (on(config, 'qs_show_all_chip')) chips.push({ value: 'all', label: opt(config, 'qs_all_label'), on: !ui.chip || ui.chip === 'all', picture: chipValues[0].picture === true, image: '' });
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
    var groups = groupInfo ? groupFilters(groupInfo.groups, groupInfo.members, products, collectionNames, ui) : [];
    var byWeight = groupInfo && groupInfo.weight ? weightGroup(groupInfo.weight, products, ui) : null;
    if (byWeight) groups.push(byWeight);
    var byPrice = groupInfo && groupInfo.price ? priceGroup(groupInfo.price, products, ui, groupInfo.symbol) : null;
    if (byPrice) groups.push(byPrice);
    var chipGroups = [];
    var sliders = [];
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = groups[gi];
      if (grp.style === 'chips') { chipGroups.push(grp); continue; }
      if (grp.kind === 'slider') {
        if (opt(config, 'qs_slider_look') === 'dropdown') menus.push({ id: grp.id, label: grp.label, value: grp.value, options: [], open: ui.menu === grp.id, slider: grp });
        else sliders.push(grp);
        continue;
      }
      var groupOptions = [{ value: '', label: 'All' }];
      for (var go = 0; go < grp.options.length; go++) groupOptions.push({ value: grp.options[go].value, label: grp.options[go].label });
      menus.push({ id: grp.id, label: grp.label, value: grp.value, options: groupOptions, open: grp.open });
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
    for (var ga = 0; ga < groups.length; ga++) if (groups[ga].value) active = true;
    return { chips: chips, menus: menus, groups: chipGroups, sliders: sliders, active: !!active };
  }

  /**
   * groupInfo (optional) = { groups, members, weight }: a picked group option
   * keeps only its collection's products, a picked weight only products with
   * a variant of that weight.
   */
  function filterProducts(products, productsByHandle, ui, pending, groupInfo) {
    var dd = ui.dd || {};
    var inChip = null;
    if (ui.chip && ui.chip.indexOf('c:') === 0) {
      inChip = {};
      var prods = productsByHandle[ui.chip.slice(2)] || [];
      for (var i = 0; i < prods.length; i++) inChip[prods[i].id] = true;
    }
    // Picked group options with known members (a group removed since, or a
    // collection not loaded yet, doesn't filter).
    var inGroups = [];
    if (groupInfo) {
      for (var g = 0; g < groupInfo.groups.length; g++) {
        var picked = dd['g:' + groupInfo.groups[g].id];
        if (picked && groupInfo.members[picked]) inGroups.push(groupInfo.members[picked]);
      }
    }
    var weightPick = groupInfo && groupInfo.weight && dd.weight && weightValueOk(groupInfo.weight, dd.weight) ? dd.weight : '';
    var pricePick = groupInfo && groupInfo.price && parseSpan(dd.price) ? dd.price : '';
    var out = [];
    for (var j = 0; j < products.length; j++) {
      var p = products[j];
      if (inChip && !inChip[p.id]) continue;
      var outOfGroup = false;
      for (var ig = 0; ig < inGroups.length; ig++) if (!inGroups[ig][p.id]) outOfGroup = true;
      if (outOfGroup) continue;
      if (weightPick && !productFitsWeight(groupInfo.weight, weightPick, p)) continue;
      if (pricePick && !productFitsPrice(pricePick, p)) continue;
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
        var variant = activeVariant(out[k], pending, groupInfo ? groupInfo.prefer : null);
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
          remaining: core.formatAmount(view, wholeMinor(view, box.remaining, box.decimals, true), box.decimals, true),
          tier: box.nextTier.label,
          weight: core.formatAmount(view, wholeMinor(view, box.amount, box.decimals), box.decimals),
          amount: core.formatAmount(view, wholeMinor(view, box.amount, box.decimals), box.decimals),
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
   *   collectionMembers { [handle]: [productId] } (the filter groups' collections)
   *   selection  { [variantId]: { productId, qty } }
   *   pending    { [productId]: variantId } (card dropdowns)
   *   ui         { chip, dd, instock, menu, sheetOpen, celebrate, checkingOut, toast }
   *   pricing    { measure, unit, tiers, maxGrams, messages, enabled } (normalized, from the server)
   *   qualifies  function (productId) → counts toward the box
   *   symbol, decimals, isMobile, cod { shown, placement, text, css, icon }
   */
  function buildModel(input) {
    var config = input.config || {};
    wholeMoney = on(config, 'qs_hide_decimals');
    var ui = input.ui || {};
    var symbol = input.symbol || '';
    var decimals = input.decimals === undefined ? 2 : input.decimals;
    var pricing = input.pricing || { tiers: [], enabled: false };
    var tiers = labelledTiers(pricing.tiers, symbol, pricing.measure);
    var view = {
      measure: pricing.measure || 'weight', unit: pricing.unit || 'kg', tiers: tiers,
      maxGrams: pricing.maxGrams === undefined ? null : pricing.maxGrams,
      messages: pricing.messages, enabled: !!pricing.enabled, currencySymbol: symbol,
    };
    var handles = input.handles || [];
    var pageHandles = handles.indexOf(EXTRA_HANDLE) === -1 && input.productsByHandle && input.productsByHandle[EXTRA_HANDLE] ? handles.concat([EXTRA_HANDLE]) : handles;
    var all = allProducts(input.productsByHandle || {}, pageHandles);
    // Left off the page by the merchant (a hidden collection only once its
    // members are known).
    var hide = pageExclusions(config);
    var hadProducts = all.length > 0;
    if (all.length) {
      var kept = [];
      for (var k = 0; k < all.length; k++) {
        var gone = !!hide.productIds[all[k].id];
        for (var hc = 0; !gone && hc < hide.collectionHandles.length; hc++) {
          var hm = input.collectionMembers && input.collectionMembers[hide.collectionHandles[hc]];
          if (hm && hm.indexOf(all[k].id) !== -1) gone = true;
        }
        if (!gone) kept.push(all[k]);
      }
      all = kept;
    }
    if (!hadProducts && input.fallbackProducts) all = input.fallbackProducts;
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
    var units = [];
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
      // One entry per item in the box (the slots bar draws a picture per item).
      for (var un = 0; un < qty && units.length < 40; un++) units.push({ variantId: vid, image: image, title: product ? product.title : '' });
      sheet.push({
        variantId: vid, productId: sel.productId, qty: qty, image: image,
        title: product ? product.title : '', variantTitle: variant && variant.title !== 'Default Title' ? variant.title : '',
        price: money(price * qty, symbol),
        stock: variant && typeof variant.stock === 'number' ? variant.stock : null,
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
    var groups = filterGroups(config);
    var weightSpec = weightFilter(config);
    var priceLabel = on(config, 'qs_filter_price') ? (cleanText(opt(config, 'qs_filter_price_label'), 40) || 'Price') : '';
    var pickedWeight = weightSpec && ui.dd && ui.dd.weight && weightValueOk(weightSpec, ui.dd.weight) ? ui.dd.weight : '';
    var pickedPrice = priceLabel && ui.dd && parseSpan(ui.dd.price) ? ui.dd.price : '';
    var groupInfo = groups.length || weightSpec || priceLabel ? {
      groups: groups,
      members: groups.length ? groupMembers(groups, input.collectionMembers, input.productsByHandle) : {},
      weight: weightSpec,
      price: priceLabel,
      symbol: symbol,
      // A filtered card shows (and adds) its variant that fits the filters.
      prefer: pickedWeight || pickedPrice ? function (variant, product) {
        return (!pickedWeight || weightFits(weightSpec, pickedWeight, variant.grams)) && (!pickedPrice || inSpan(pickedPrice, priceOf(product, variant)));
      } : null,
    } : null;
    var row = filterRow(config, all, handles, input.collectionNames || {}, ui, input.collectionImages || {}, input.productsByHandle || {}, groupInfo);
    var shown = filterProducts(all, input.productsByHandle || {}, ui, input.pending, groupInfo);
    // A page of cards at a time: big collections (1000+ products) would make
    // every redraw slow. "Show more" (ui.pages) adds the next lot.
    var step = pageSize(config);
    var pages = ui.pagesFor === filterKey(ui) ? Math.max(1, Math.floor(Number(ui.pages)) || 1) : 1;
    var more = Math.max(0, shown.length - step * pages);
    if (more) shown = shown.slice(0, step * pages);
    var cards = [];
    var perProduct = maxPerProduct(config);
    var badgeTag = String(opt(config, 'qs_badge_tag') || '').trim();
    for (var c = 0; c < shown.length; c++) {
      var p = shown[c];
      var v = activeVariant(p, input.pending, groupInfo ? groupInfo.prefer : null);
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
        id: p.id, title: p.title, summary: p.summary || '', image: img, images: productImages(p, img),
        badge: badgeTag && hasTag(p, badgeTag) ? (opt(config, 'qs_badge_text') || badgeTag) : '',
        variants: options.length > 1 && !(options.length === 1 && options[0].title === 'Default Title') ? options : [],
        weightText: weightText,
        price: money(pr, symbol), compare: cp ? money(cp, symbol) : '', off: cp ? Math.round(((cp - pr) / cp) * 100) : 0,
        available: !v || (v.available !== false && v.stock !== 0),
        // How many Shopify will sell (null = no limit): + stops there.
        stock: v && typeof v.stock === 'number' ? v.stock : null,
        variantId: v ? v.id : '',
        qty: v ? (qtyByVariant[v.id] || 0) : 0,
        // The box already holds the most of this product allowed (any variant).
        full: perProduct > 0 && productQty(selection, p.id) >= perProduct,
        counts: input.qualifies ? !!input.qualifies(p.id) : true,
      });
    }

    // One section per collection, in the merchant's order (qs_group_by_collection).
    var sections = null;
    if (on(config, 'qs_group_by_collection') && cards.length) {
      var home = {};
      // A collection chip picked: everything shown is that collection's.
      var picked = ui.chip && ui.chip.indexOf('c:') === 0 ? ui.chip.slice(2) : '';
      if (picked) for (var pk = 0; pk < cards.length; pk++) home[cards[pk].id] = picked;
      for (var ph = 0; ph < pageHandles.length; ph++) {
        var inCol = (input.productsByHandle || {})[pageHandles[ph]] || [];
        for (var pi = 0; pi < inCol.length; pi++) if (!home[inCol[pi].id]) home[inCol[pi].id] = pageHandles[ph];
      }
      sections = [];
      for (var sh = 0; sh < pageHandles.length; sh++) {
        var handle = pageHandles[sh];
        var inSection = [];
        for (var sc = 0; sc < cards.length; sc++) if (home[cards[sc].id] === handle) inSection.push(cards[sc]);
        if (!inSection.length) continue;
        sections.push({
          handle: handle,
          title: handle === EXTRA_HANDLE ? String(opt(config, 'qs_extra_title') || '').trim() : collectionTitle(config, handle, input.collectionNames || {}),
          cards: inSection,
        });
      }
    }

    // The product popup (ui.popup = product id), while that card is shown.
    var popup = null;
    if (ui.popup && on(config, 'qs_product_popup')) {
      for (var pc = 0; pc < cards.length; pc++) {
        if (String(cards[pc].id) !== String(ui.popup)) continue;
        var count = cards[pc].images.length;
        var at = Math.max(0, Math.min(count - 1, Math.round(Number(ui.popupImage) || 0)));
        popup = { card: cards[pc], index: count ? at : 0 };
        break;
      }
    }

    var bar = barMessage(view, box);
    var savedTemplate = box.nextTier && view.enabled ? opt(config, 'qs_saved_text') : opt(config, 'qs_saved_done_text');
    return {
      config: config,
      selection: selection,
      isMobile: !!input.isMobile,
      symbol: symbol,
      title: config.collection_title || input.templateName || '',
      description: config.collection_description || '',
      row: row,
      cards: cards,
      sections: sections,
      // Products left after the cards drawn ("Show more").
      more: more,
      empty: !all.length ? 'No products yet. Choose collections for this combo.' : (!cards.length ? 'Nothing matches these filters.' : ''),
      view: view,
      box: box,
      progress: progress,
      topMessage: topMessage(view, box),
      bar: {
        items: items,
        thumbs: thumbs,
        units: units,
        sheet: sheet,
        message: bar,
        saved: saved > 0.004 ? core.fillMessage(savedTemplate, { saved: money(saved, symbol) }) : '',
        total: money(finalPrice, symbol),
        canCheckout: canCheckout(config, box, items, tiers) && !ui.checkingOut,
        // Why checkout is locked (first offer required, or over the max), shown
        // when the shopper taps the dimmed button instead of nothing happening.
        lockedWhy: items > 0 && !ui.checkingOut && !canCheckout(config, box, items, tiers) ? (bar.text || 'Add more items to check out.') : '',
        checkingOut: !!ui.checkingOut,
        sheetOpen: !!ui.sheetOpen,
        celebrate: !!ui.celebrate,
      },
      totals: { total: total, discount: boxDiscount, finalPrice: finalPrice, saved: saved, items: items },
      cod: input.cod || { shown: false },
      toast: ui.toast || '',
      popup: popup,
    };
  }

  // A product's pictures for the popup: the chosen variant's first, then the
  // product's own (https only, no repeats, at most 10).
  function productImages(p, first) {
    var list = [];
    var push = function (url, alt) {
      url = String(url || '');
      if (!/^https:\/\//i.test(url) && !/^data:image\//i.test(url)) return;
      for (var k = 0; k < list.length; k++) if (list[k].url === url) return;
      if (list.length < 10) list.push({ url: url, alt: alt || p.title || '' });
    };
    push(first, p.title);
    var imgs = p.images || [];
    for (var n = 0; n < imgs.length; n++) push(imgs[n] && (imgs[n].url || imgs[n].src), imgs[n] && imgs[n].altText);
    if (p.image) push(p.image.url || p.image.src, p.image.altText);
    return list;
  }

  /* ── HTML ───────────────────────────────────────────────────────────── */

  var ICON_PLUS = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
  var ICON_GRID = '<svg viewBox="0 0 24 24" width="40%" height="40%" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>';
  var ICON_FILTER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';

  // A text size the merchant set (6-40px), else null (= the stylesheet's own).
  function sizePx(config, key) {
    var v = opt(config, key);
    if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return null;
    return num(v, 14, 6, 40);
  }

  function vars(config) {
    var pairs = [
      ['--bxq-page', safeCss(opt(config, 'qs_page_bg'), DEFAULTS.qs_page_bg)],
      ['--bxq-card', safeCss(opt(config, 'qs_card_bg'), DEFAULTS.qs_card_bg)],
      ['--bxq-text', safeCss(opt(config, 'qs_text_color'), DEFAULTS.qs_text_color)],
      ['--bxq-accent', safeCss(opt(config, 'qs_accent'), DEFAULTS.qs_accent)],
      ['--bxq-off', safeCss(opt(config, 'qs_off_color'), DEFAULTS.qs_off_color)],
      ['--bxq-badge', safeCss(opt(config, 'qs_badge_bg'), DEFAULTS.qs_badge_bg)],
      ['--bxq-radius', num(opt(config, 'qs_card_radius'), 14, 0, 40) + 'px'],
      ['--bxq-ratio', { portrait: '4/5', tall: '2/3', landscape: '4/3' }[opt(config, 'qs_image_ratio')] || '1/1'],
      ['--bxq-fit', opt(config, 'qs_image_fit') === 'cover' ? 'cover' : 'contain'],
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
      ['--bxq-lbl-fs', num(opt(config, 'qs_top_label_size'), 12, 6, 22) + 'px'],
      ['--bxq-lbl-sub', num(opt(config, 'qs_top_sub_size'), 11, 6, 20) + 'px'],
      ['--bxq-bar-bg', safeCss(opt(config, 'qs_bar_bg'), DEFAULTS.qs_bar_bg)],
      ['--bxq-bar-text', safeCss(opt(config, 'qs_bar_text'), DEFAULTS.qs_bar_text)],
      ['--bxq-save', safeCss(opt(config, 'qs_bar_save'), DEFAULTS.qs_bar_save)],
      ['--bxq-bar-r', num(opt(config, 'qs_bar_radius'), 20, 0, 40) + 'px'],
      ['--bxq-icon-bg', safeCss(opt(config, 'qs_bar_icon_bg'), DEFAULTS.qs_bar_icon_bg)],
      ['--bxq-btn', safeCss(opt(config, 'qs_btn_bg'), DEFAULTS.qs_btn_bg)],
      ['--bxq-btn-text', safeCss(opt(config, 'qs_btn_text_color'), DEFAULTS.qs_btn_text_color)],
      ['--bxq-btn-r', num(opt(config, 'qs_btn_radius'), 14, 0, 40) + 'px'],
      ['--bxq-btn-fs-m', num(opt(config, 'qs_btn_font_size_m'), 15, 11, 22) + 'px'],
      ['--bxq-btn-py', num(opt(config, 'qs_btn_pad_y'), 14, 6, 28) + 'px'],
      ['--bxq-btn-px', num(opt(config, 'qs_btn_pad_x'), 26, 8, 48) + 'px'],
      ['--bxq-btn-py-m', Math.max(4, num(opt(config, 'qs_btn_pad_y'), 14, 6, 28) - 2) + 'px'],
      ['--bxq-btn-px-m', Math.min(16, num(opt(config, 'qs_btn_pad_x'), 26, 8, 48)) + 'px'],
      ['--bxq-col-size', num(opt(config, 'qs_chip_image_size'), 64, 40, 120) + 'px'],
      ['--bxq-col-size-m', Math.round(num(opt(config, 'qs_chip_image_size'), 64, 40, 120) * 0.8) + 'px'],
      ['--bxq-col-r', { rounded: '16px', square: '4px' }[opt(config, 'qs_chip_image_shape')] || '50%'],
    ];
    // Only once the merchant sets it: unset, the Go to Cart text keeps the
    // theme's size (what pages showed before the setting existed).
    var btnFs = opt(config, 'qs_btn_font_size');
    if (btnFs !== null && btnFs !== '' && isFinite(Number(btnFs))) pairs.push(['--bxq-btn-fs', num(btnFs, 16, 12, 24) + 'px']);
    // Phones: the merchant's size for every style, else as before (milestones 1px smaller).
    var lblPhone = opt(config, 'qs_top_label_size_m');
    if (lblPhone !== null && lblPhone !== '' && isFinite(Number(lblPhone))) {
      pairs.push(['--bxq-lbl-fs-m', num(lblPhone, 12, 6, 22) + 'px']);
      pairs.push(['--bxq-lbl-fs-mile-m', num(lblPhone, 12, 6, 22) + 'px']);
    } else {
      pairs.push(['--bxq-lbl-fs-mile-m', Math.max(6, num(opt(config, 'qs_top_label_size'), 12, 6, 22) - 1) + 'px']);
    }
    // Card and filter text sizes, only once the merchant sets them.
    var sizes = [
      ['qs_card_title_size', '--bxq-title-fs'], ['qs_card_title_size_m', '--bxq-title-fs-m'],
      ['qs_card_text_size', '--bxq-ctext-fs'], ['qs_card_text_size_m', '--bxq-ctext-fs-m'],
      ['qs_card_price_size', '--bxq-price-fs'], ['qs_card_price_size_m', '--bxq-price-fs-m'],
      ['qs_filter_font_size', '--bxq-chip-fs'], ['qs_filter_font_size_m', '--bxq-chip-fs-m'],
      ['qs_group_title_size', '--bxq-sec-fs'], ['qs_group_title_size_m', '--bxq-sec-fs-m'],
    ];
    for (var sz = 0; sz < sizes.length; sz++) {
      var px = sizePx(config, sizes[sz][0]);
      if (px === null) continue;
      pairs.push([sizes[sz][1], px + 'px']);
      // The struck compare-at price follows the price (14px next to 19px before).
      if (sizes[sz][1] === '--bxq-price-fs') pairs.push(['--bxq-cmp-fs', Math.max(6, Math.round(px * 0.74)) + 'px']);
      if (sizes[sz][1] === '--bxq-price-fs-m') pairs.push(['--bxq-cmp-fs-m', Math.max(6, Math.round(px * 0.74)) + 'px']);
    }
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

  // Collection chips as pictures: a row of tiles above the filter chips.
  // qs_chips_align: margins push a scrolling row to the centre / right while
  // it fits, and it still scrolls from its start when it doesn't.
  function alignClass(config) {
    var a = sideOf(config, 'qs_chips_align');
    return a === 'left' ? '' : ' bxq-al-' + a;
  }

  function renderCollectionBar(chips, config) {
    var html = '<div class="bxq-colbar' + alignClass(config) + '" role="tablist" aria-label="Collections">';
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      html += '<button type="button" role="tab" class="bxq-col' + (chip.on ? ' is-on' : '') + '" aria-selected="' + (chip.on ? 'true' : 'false') + '" data-combo-action="qs-chip" data-value="' + esc(chip.value) + '">'
        + '<span class="bxq-col-img">' + (chip.image ? '<img src="' + esc(chip.image) + '" alt="" loading="lazy" />' : (chip.value === 'all' ? ICON_GRID : '<span class="bxq-col-letter">' + esc(String(chip.label || '?').charAt(0).toUpperCase()) + '</span>')) + '</span>'
        + '<span class="bxq-col-name">' + esc(chip.label) + '</span></button>';
    }
    return html + '</div>';
  }

  // Collection filter groups shown as chips: one labelled row per group; a
  // tap picks that option, a tap on the picked one clears the group.
  function renderChipGroups(groups) {
    var html = '';
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      html += '<div class="bxq-filters bxq-gchips" role="group" aria-label="' + esc(group.label) + '"><span class="bxq-gchips-label">' + esc(group.label) + '</span>';
      for (var o = 0; o < group.options.length; o++) {
        var option = group.options[o];
        html += '<button type="button" class="bxq-chip' + (option.on ? ' is-on' : '') + '" aria-pressed="' + (option.on ? 'true' : 'false') + '" data-combo-action="qs-group" data-menu="' + esc(group.id) + '" data-value="' + esc(option.value) + '">' + esc(option.label) + '</button>';
      }
      html += '</div>';
    }
    return html;
  }

  // Weight / price sliders: two range inputs over one track. Dragging only
  // updates the text and the fill (rangeInput); letting go filters
  // (applyRange), so the page isn't redrawn under the shopper's finger.
  function renderSliders(sliders) {
    var html = '';
    for (var i = 0; i < sliders.length; i++) {
      var sl = sliders[i];
      var span = sl.max - sl.min;
      var left = ((sl.lo - sl.min) / span) * 100;
      var right = ((sl.max - sl.hi) / span) * 100;
      var attrs = ' min="' + sl.min + '" max="' + sl.max + '" step="' + sl.step + '" data-combo-range="' + esc(sl.id) + '"';
      html += '<div class="bxq-filters bxq-gchips bxq-range" role="group" aria-label="' + esc(sl.label) + '" data-unit="' + esc(sl.unit) + '" data-symbol="' + esc(sl.symbol) + '">'
        + '<span class="bxq-gchips-label">' + esc(sl.label) + '</span>'
        + '<div class="bxq-range-box"><div class="bxq-range-track"><div class="bxq-range-fill" style="left:' + left.toFixed(2) + '%;right:' + right.toFixed(2) + '%"></div></div>'
        + '<input type="range" class="bxq-range-in"' + attrs + ' value="' + sl.lo + '" aria-label="' + esc(sl.label) + ' from" />'
        + '<input type="range" class="bxq-range-in"' + attrs + ' value="' + sl.hi + '" aria-label="' + esc(sl.label) + ' to" />'
        + '</div><span class="bxq-range-val' + (sl.value ? ' is-on' : '') + '">' + esc(sl.text) + '</span></div>';
    }
    return html;
  }

  function rangeParts(input) {
    var box = input.closest ? input.closest('.bxq-range') : null;
    if (!box) return null;
    var ins = box.querySelectorAll('input[data-combo-range]');
    if (ins.length !== 2) return null;
    var a = Number(ins[0].value);
    var b = Number(ins[1].value);
    return { box: box, ins: ins, lo: Math.min(a, b), hi: Math.max(a, b), min: Number(ins[0].min), max: Number(ins[0].max) };
  }

  /** While a slider moves: keep the handles from crossing, move the fill, update the text. */
  function rangeInput(input) {
    var r = rangeParts(input);
    if (!r) return;
    if (Number(r.ins[0].value) > Number(r.ins[1].value)) {
      if (input === r.ins[0]) r.ins[0].value = r.ins[1].value; else r.ins[1].value = r.ins[0].value;
      r = rangeParts(input);
    }
    var span = r.max - r.min || 1;
    var fill = r.box.querySelector('.bxq-range-fill');
    if (fill) { fill.style.left = (((r.lo - r.min) / span) * 100).toFixed(2) + '%'; fill.style.right = (((r.max - r.hi) / span) * 100).toFixed(2) + '%'; }
    var text = r.box.querySelector('.bxq-range-val');
    if (text) text.textContent = spanText(r.box.getAttribute('data-unit'), r.lo, r.hi, r.box.getAttribute('data-symbol'));
  }

  /**
   * Pins each open dropdown under its chip. The menu is position:fixed (so the
   * filter row's horizontal scroll can't clip it), and a fixed box with no
   * coordinates lands wherever the theme's layout puts it, often far from the
   * chip. This gives it real coordinates, measured after the theme has had its
   * say (a transformed theme wrapper shifts fixed boxes: the shift is measured
   * and taken out), opening above the chip when there's no room below. Call
   * after every render and on scroll / resize.
   */
  function placeMenus(scope) {
    if (!scope || !scope.querySelectorAll || typeof window === 'undefined') return;
    var open = scope.querySelectorAll('.bxq-dd.is-open');
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    for (var i = 0; i < open.length; i++) {
      var chip = open[i].querySelector('[data-combo-action="qs-menu"]');
      var menu = open[i].querySelector('.bxq-menu');
      if (!chip || !menu) continue;
      var r = chip.getBoundingClientRect();
      menu.style.margin = '0';
      menu.style.top = '0px';
      menu.style.left = '0px';
      var at = menu.getBoundingClientRect(); // where (0, 0) really lands
      var left = Math.max(8, Math.min(r.left, vw - at.width - 8));
      var top = r.bottom + 6;
      if (top + at.height > vh - 8 && r.top - 6 - at.height >= 8) top = r.top - 6 - at.height;
      menu.style.left = Math.round(left - at.left) + 'px';
      menu.style.top = Math.round(top - at.top) + 'px';
    }
  }

  /** A slider let go: its span into ui.dd (the whole span = no filter). Returns true when it was one. */
  function applyRange(ui, input) {
    var key = input && input.getAttribute ? input.getAttribute('data-combo-range') : null;
    var r = key ? rangeParts(input) : null;
    if (!r) return false;
    if (!ui.dd) ui.dd = {};
    ui.dd[key] = r.lo <= r.min && r.hi >= r.max ? '' : 's:' + r.lo + '-' + r.hi;
    // A slider inside a dropdown stays open, so the shopper can keep adjusting.
    return true;
  }

  // Desktop filters in a left column: every filter open as a list (no
  // dropdowns), sliders inline, Clear at the top.
  function filtersOnLeft(model) {
    var row = model.row;
    if (model.isMobile || opt(model.config, 'qs_filter_position') !== 'left') return false;
    for (var i = 0; i < row.chips.length; i++) if (!row.chips[i].picture) return true;
    return row.menus.length > 0 || (row.groups || []).length > 0 || (row.sliders || []).length > 0;
  }

  function sideOption(action, menu, value, label, on) {
    return '<button type="button" class="bxq-side-opt' + (on ? ' is-on' : '') + '" aria-pressed="' + (on ? 'true' : 'false') + '" data-combo-action="' + action + '"'
      + (menu ? ' data-menu="' + esc(menu) + '"' : '') + ' data-value="' + esc(value) + '"><span class="bxq-side-radio" aria-hidden="true"></span>' + esc(label) + '</button>';
  }

  function renderSideFilters(model) {
    var row = model.row;
    var html = '<div class="bxq-side-head"><span>Filters</span>'
      + (row.active ? '<button type="button" class="bxq-side-clear" data-combo-action="qs-clear">Clear all</button>' : '') + '</div>';
    var chips = [];
    var toggles = [];
    for (var c = 0; c < row.chips.length; c++) {
      if (row.chips[c].picture) continue;
      (row.chips[c].toggle ? toggles : chips).push(row.chips[c]);
    }
    var i;
    if (chips.length) {
      html += '<div class="bxq-side-sec" role="group">';
      for (i = 0; i < chips.length; i++) html += sideOption('qs-chip', '', chips[i].value, chips[i].label, chips[i].on);
      html += '</div>';
    }
    for (var m = 0; m < row.menus.length; m++) {
      var menu = row.menus[m];
      html += '<div class="bxq-side-sec" role="group" aria-label="' + esc(menu.label) + '"><p class="bxq-side-title">' + esc(menu.label) + '</p>';
      if (menu.slider) html += renderSliders([menu.slider]);
      for (i = 0; i < menu.options.length; i++) {
        var option = menu.options[i];
        var on = (option.value || '') === (menu.value || '') || (menu.isSort && !menu.value && option.value === 'featured');
        html += sideOption('qs-pick', menu.id, option.value, option.label, on);
      }
      html += '</div>';
    }
    var groups = row.groups || [];
    for (var g = 0; g < groups.length; g++) {
      html += '<div class="bxq-side-sec" role="group" aria-label="' + esc(groups[g].label) + '"><p class="bxq-side-title">' + esc(groups[g].label) + '</p>';
      for (i = 0; i < groups[g].options.length; i++) html += sideOption('qs-group', groups[g].id, groups[g].options[i].value, groups[g].options[i].label, groups[g].options[i].on);
      html += '</div>';
    }
    var sliders = row.sliders || [];
    for (var sl = 0; sl < sliders.length; sl++) {
      html += '<div class="bxq-side-sec"><p class="bxq-side-title">' + esc(sliders[sl].label) + '</p>' + renderSliders([sliders[sl]]) + '</div>';
    }
    for (i = 0; i < toggles.length; i++) {
      html += '<div class="bxq-side-sec">' + '<button type="button" class="bxq-side-opt bxq-side-check' + (toggles[i].on ? ' is-on' : '') + '" aria-pressed="' + (toggles[i].on ? 'true' : 'false') + '" data-combo-action="qs-instock" data-value="instock"><span class="bxq-side-radio" aria-hidden="true"></span>' + esc(toggles[i].label) + '</button></div>';
    }
    return html;
  }

  function renderFilters(model) {
    var row = model.row;
    var pictureChips = [];
    var chips = [];
    for (var p = 0; p < row.chips.length; p++) (row.chips[p].picture ? pictureChips : chips).push(row.chips[p]);
    var bar = pictureChips.length ? renderCollectionBar(pictureChips, model.config) : '';
    var groupRows = renderChipGroups(row.groups || []) + renderSliders(row.sliders || []);
    if (!chips.length && !row.menus.length) return bar + groupRows;
    var html = bar + '<div class="bxq-filters' + alignClass(model.config) + '">';
    html += '<button type="button" class="bxq-chip bxq-chip--icon' + (row.active ? ' is-active' : '') + '" data-combo-action="qs-clear" aria-label="Clear filters" title="Clear filters">' + ICON_FILTER + '</button>';
    for (var i = 0; i < chips.length; i++) {
      var chip = chips[i];
      html += '<button type="button" class="bxq-chip' + (chip.on ? ' is-on' : '') + '" aria-pressed="' + (chip.on ? 'true' : 'false') + '" data-combo-action="' + (chip.toggle ? 'qs-instock' : 'qs-chip') + '" data-value="' + esc(chip.value) + '">' + esc(chip.label) + '</button>';
    }
    for (var m = 0; m < row.menus.length; m++) {
      var menu = row.menus[m];
      var current = '';
      for (var o = 0; o < menu.options.length; o++) if (menu.value && menu.options[o].value === menu.value) current = menu.options[o].label;
      html += '<div class="bxq-dd' + (menu.open ? ' is-open' : '') + '">';
      // A slider behind a chip: the chip names the picked span.
      if (menu.slider) current = menu.value ? menu.slider.text : '';
      html += '<button type="button" class="bxq-chip' + (menu.value ? ' is-on' : '') + '" aria-expanded="' + (menu.open ? 'true' : 'false') + '" data-combo-action="qs-menu" data-menu="' + esc(menu.id) + '">'
        + esc(menu.isSort || !current ? menu.label : current) + ICON_DOWN + '</button>';
      if (menu.open && menu.slider) {
        html += '<div class="bxq-menu bxq-menu--range">' + renderSliders([menu.slider]) + '</div>';
      } else if (menu.open) {
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
    return html + groupRows;
  }

  /** The text under the bar: which lines show and their sizes (px). */
  function labelLook(config, isMobile) {
    var size = num(opt(config, 'qs_top_label_size'), 12, 6, 22);
    var phone = opt(config, 'qs_top_label_size_m');
    var phoneSet = phone !== null && phone !== '' && isFinite(Number(phone));
    var look = {
      labels: on(config, 'qs_top_show_labels'),
      name: on(config, 'qs_top_show_name'),
      amount: on(config, 'qs_top_show_amount'),
      size: size,
      sub: num(opt(config, 'qs_top_sub_size'), 11, 6, 20),
      phone: phoneSet ? num(phone, size, 6, 22) : null,
    };
    look.any = look.labels && (look.name || look.amount);
    // The size used on this screen (milestones were 1px smaller on phones).
    look.mileSize = isMobile ? (look.phone !== null ? look.phone : Math.max(6, size - 1)) : size;
    look.barSize = isMobile && look.phone !== null ? look.phone : size;
    return look;
  }

  function labelText(mark, look) {
    return (look.name ? '<b>' + esc(mark.label) + '</b>' : '') + (look.amount ? '<small>' + esc(mark.at) + '</small>' : '');
  }

  /**
   * Milestone icon and circle sizes (px) for count milestones: the merchant's
   * icon size (phones: its own, else the desktop one), circle = icon + 16.
   * When the tiers don't fit side by side (7+ on a phone) both shrink in step,
   * so circles never overlap; up to 6 tiers on a phone keep the default size.
   */
  function mileSizes(config, isMobile, count) {
    var icon = num(opt(config, 'qs_mile_icon_size'), 18, 12, 48);
    var phone = opt(config, 'qs_mile_icon_size_m');
    if (isMobile && phone !== null && phone !== '' && isFinite(Number(phone))) icon = num(phone, icon, 12, 48);
    var dot = icon + 16;
    var room = Math.floor((isMobile ? 260 : 640) / Math.max(1, count)) - 8;
    if (dot > room) {
      var fit = Math.max(22, room);
      icon = Math.max(10, Math.round((icon * fit) / dot));
      dot = fit;
    }
    return { icon: icon, dot: dot };
  }

  function renderTop(model) {
    var config = model.config;
    var style = opt(config, 'qs_top_style');
    if (style === 'none' || !model.view.enabled || !model.view.tiers.length) return '';
    var progress = model.progress;
    var msg = model.topMessage;
    var look = labelLook(config, model.isMobile);
    var labels = look.any;
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
        // Room for the lines shown (38px at the default sizes).
        var ticksH = Math.round((look.name ? look.barSize * 1.3 : 0) + (look.amount ? look.sub * 1.3 : 0)) + 8;
        html += '<div class="bxq-ticks" style="height:' + ticksH + 'px">';
        for (i = 0; i < progress.marks.length; i++) {
          var mk = progress.marks[i];
          html += '<span class="bxq-tick-label' + (mk.hit ? ' is-hit' : '') + '" style="left:' + mk.percent.toFixed(1) + '%">' + labelText(mk, look) + '</span>';
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
          + (labels ? '<div class="bxq-step-label">' + labelText(step, look) + '</div>' : '')
          + '</div>';
        prev = step.percent;
      }
      html += '</div>';
    } else if (style === 'milestones') {
      // Evenly spaced, each label as wide as its share of the line: placed
      // by weight, tiers close together (1 kg and 2 kg of 5 kg) overlapped on
      // phones. The fill runs piecewise between the dots, so it still reaches
      // a dot exactly when its tier unlocks.
      var count = progress.marks.length;
      var evenAt = function (k) { return ((k + 1) / count) * 100; };
      var milesFill = 100;
      var fromAt = 0;
      var fromEven = 0;
      for (i = 0; i < count; i++) {
        var markAt = progress.marks[i].percent;
        if (progress.percent <= markAt) {
          milesFill = fromEven + ((progress.percent - fromAt) / Math.max(0.0001, markAt - fromAt)) * (evenAt(i) - fromEven);
          break;
        }
        fromAt = markAt;
        fromEven = evenAt(i);
      }
      milesFill = Math.max(0, Math.min(100, milesFill));
      var mile = mileSizes(config, model.isMobile, count);
      // Under the circle: up to two lines of name + the amount (40px at the default sizes).
      var below = labels ? Math.round(4 + (look.name ? look.mileSize * 1.85 : 0) + (look.amount ? look.sub * 1.25 : 0)) : 4;
      html += '<div class="bxq-miles" style="--bxq-mile-share:' + (100 / Math.max(1, count)).toFixed(2) + '%;--bxq-mile-dot:' + mile.dot + 'px;--bxq-mile-icon:' + mile.icon + 'px;height:' + (mile.dot + below) + 'px"><div class="bxq-miles-line"><div class="bxq-miles-fill" style="width:' + milesFill.toFixed(1) + '%"></div></div>';
      for (i = 0; i < count; i++) {
        var ms = progress.marks[i];
        html += '<div class="bxq-mile' + (ms.hit ? ' is-hit' : '') + (ms.next ? ' is-next' : '') + '" style="left:' + evenAt(i).toFixed(1) + '%">'
          + '<span class="bxq-mile-dot">' + (ms.icon ? iconHtml(ms.icon, 'bxq-mile-icon', ms.iconIndex) : '') + '</span>'
          + (labels ? '<span class="bxq-mile-label">' + labelText(ms, look) + '</span>' : '')
          + '</div>';
      }
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  /** Normal card layout: full-width Add button (or stepper) under the price. */
  function renderCardCta(model, card) {
    var config = model.config;
    if (!card.available) return '<button type="button" class="bxq-cta is-out" disabled>Out of stock</button>';
    if (card.qty > 0) {
      return '<div class="bxq-cta bxq-cta--stepper"><button type="button" data-combo-action="qty-dec" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Remove one">−</button>'
        + '<span aria-live="polite">' + card.qty + '</span>'
        + '<button type="button" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Add one"' + atStock(card) + '>+</button></div>';
    }
    return '<button type="button" class="bxq-cta" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Add ' + esc(card.title) + '"' + (card.full ? ' disabled' : '') + '>' + esc(opt(config, 'qs_add_label') || 'Add') + '</button>';
  }

  // ' disabled' once the box holds all Shopify will sell of this variant, or
  // the most of this product allowed (qs_max_per_product).
  function atStock(card) {
    return card.full || (card.stock !== null && card.stock !== undefined && card.qty >= card.stock) ? ' disabled' : '';
  }

  // A box line's + is off at the per-product limit or the variant's stock.
  function lineFull(model, line) {
    var max = maxPerProduct(model.config);
    if (max && productQty(model.selection || {}, line.productId) >= max) return true;
    return line.stock !== null && line.stock !== undefined && line.qty >= line.stock;
  }

  function renderCard(model, card) {
    var config = model.config;
    var normal = opt(config, 'qs_card_layout') === 'normal';
    var html = '<article class="bxq-card' + (normal ? ' bxq-card--normal' : '') + (card.qty ? ' is-in' : '') + (card.available ? '' : ' is-out') + '" data-product-id="' + esc(card.id) + '">';
    html += '<div class="bxq-media">';
    var opens = on(config, 'qs_product_popup') ? ' data-combo-action="qs-view" data-product-id="' + esc(card.id) + '" role="button" tabindex="0"' : '';
    html += card.image ? '<img src="' + esc(card.image) + '" alt="' + esc(card.title) + '" loading="lazy"' + opens + ' />' : '<span class="bxq-noimg"' + opens + '></span>';
    if (card.badge) html += '<span class="bxq-badge">' + esc(card.badge) + '</span>';
    if (normal) {
      if (!card.available) html += '<span class="bxq-soldout">Out of stock</span>';
    } else if (!card.available) {
      html += '<span class="bxq-soldout">Out of stock</span>';
    } else if (card.qty > 0) {
      html += '<div class="bxq-stepper"><button type="button" data-combo-action="qty-dec" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Remove one">−</button>'
        + '<span aria-live="polite">' + card.qty + '</span>'
        + '<button type="button" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Add one"' + atStock(card) + '>+</button></div>';
    } else {
      html += '<button type="button" class="bxq-add" data-combo-action="qty-inc" data-product-id="' + esc(card.id) + '" data-variant-id="' + esc(card.variantId) + '" aria-label="Add ' + esc(card.title) + '"' + (card.full ? ' disabled' : '') + '>' + ICON_PLUS + '</button>';
    }
    html += '</div><div class="bxq-info">';
    var eyebrow = opt(config, 'qs_card_eyebrow');
    if (eyebrow) html += '<div class="bxq-eyebrow">' + esc(eyebrow) + '</div>';
    html += '<h3 class="bxq-name"' + opens + '>' + esc(card.title) + '</h3>';
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
    var priceHtml = (on(config, 'qs_show_price') ? '<b>' + esc(card.price) + '</b>' : '') + (card.compare && on(config, 'qs_show_compare') ? '<s>' + esc(card.compare) + '</s>' : '');
    if (priceHtml) html += '<div class="bxq-price">' + priceHtml + '</div>';
    if (!card.counts && model.view.enabled) html += '<div class="bxq-nocount">Not part of the box offer</div>';
    if (normal) html += renderCardCta(model, card);
    html += '</div></article>';
    return html;
  }

  /**
   * The slots bar (quantity boxes): one box per item the next offer needs
   * (the last offer once all are unlocked, or more when the box holds more);
   * a filled box shows the item's picture (tap = take one out), an empty one
   * a +. Shown from the first visit, before anything is added. At most 8
   * boxes (5 on phones); past that the last one counts ("6/12").
   */
  function renderSlots(model) {
    var bar = model.bar;
    var tiers = model.view.tiers;
    var next = model.box.nextTier;
    var target = Math.max(next ? next.min_grams : tiers[tiers.length - 1].min_grams, bar.items);
    var cap = model.isMobile ? 5 : 8;
    var count = Math.min(target, cap);
    var html = '<div class="bxq-slots" role="list" aria-label="' + bar.items + ' of ' + target + ' items">';
    for (var i = 0; i < count; i++) {
      if (target > cap && i === count - 1) { html += '<span class="bxq-slot is-more" role="listitem">' + bar.items + '/' + target + '</span>'; continue; }
      var unit = bar.units[i];
      html += unit
        ? '<button type="button" role="listitem" class="bxq-slot is-filled" data-combo-action="box-dec" data-variant-id="' + esc(unit.variantId) + '" aria-label="Remove ' + esc(unit.title) + '">'
          + (unit.image ? '<img src="' + esc(unit.image) + '" alt="" loading="lazy" />' : '<span class="bxq-noimg"></span>') + '<span class="bxq-slot-x" aria-hidden="true">&times;</span></button>'
        : '<span class="bxq-slot" role="listitem" aria-label="Empty">' + ICON_PLUS + '</span>';
    }
    return html + '</div>';
  }

  function renderBar(model) {
    var config = model.config;
    var bar = model.bar;
    var style = opt(config, 'qs_bar_style');
    // Slots only count items: weight / value boxes (or no live offer) get the full bar.
    var slots = style === 'slots' && model.view.enabled && model.view.measure === 'quantity' && model.view.tiers.length > 0;
    if (style === 'slots' && !slots) style = 'full';
    if (!bar.items && !slots) return '';
    var html = '<div class="bxq-bar bxq-bar--' + esc(style) + (bar.celebrate ? ' is-celebrate' : '') + '" role="region" aria-label="Your box">';

    if (bar.sheetOpen) {
      html += '<div class="bxq-sheet">';
      for (var s = 0; s < bar.sheet.length; s++) {
        var line = bar.sheet[s];
        html += '<div class="bxq-line">' + (line.image ? '<img src="' + esc(line.image) + '" alt="" />' : '<span class="bxq-noimg"></span>')
          + '<div class="bxq-line-main"><div class="bxq-line-name">' + esc(line.title) + '</div>' + (line.variantTitle ? '<div class="bxq-line-sub">' + esc(line.variantTitle) + '</div>' : '') + '</div>'
          + '<div class="bxq-mini"><button type="button" data-combo-action="box-dec" data-variant-id="' + esc(line.variantId) + '" aria-label="Remove one">−</button><span>' + line.qty + '</span>'
          + '<button type="button" data-combo-action="box-inc" data-variant-id="' + esc(line.variantId) + '" aria-label="Add one"' + (lineFull(model, line) ? ' disabled' : '') + '>+</button></div>'
          + (on(config, 'qs_sheet_show_price') ? '<div class="bxq-line-price">' + esc(line.price) + '</div>' : '') + '</div>';
      }
      html += '<button type="button" class="bxq-clear" data-combo-action="reset">Remove all</button></div>';
    }

    var msg = bar.message;
    var showMessage = on(config, 'qs_bar_show_message') && msg.text;
    var progress = model.progress;
    if (slots) {
      if (showMessage) html += '<div class="bxq-slots-msg is-' + esc(msg.tone) + '" aria-live="polite">' + boldTier(msg.text, msg.tier) + '</div>';
      html += '<div class="bxq-row">' + renderSlots(model);
      if (bar.items) html += barActions(model);
      return html + '</div></div>';
    }
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

    html += barActions(model);
    html += '</div></div>';
    return html;
  }

  // Go to Cart (and COD) of the bottom bar.
  function barActions(model) {
    var config = model.config;
    var bar = model.bar;
    var cod = model.cod || {};
    var codPlacement = cod.placement === 'replace' || cod.placement === 'above' ? cod.placement : 'below';
    var disabled = !bar.canCheckout;
    var label = bar.checkingOut ? 'Adding…' : opt(config, 'qs_btn_label');
    // Locked (not busy): looks dimmed but still answers a tap with the reason.
    var lockAttrs = bar.lockedWhy
      ? ' aria-disabled="true" data-value="' + esc(bar.lockedWhy) + '"'
      : (disabled ? ' disabled' : '');
    var goAction = bar.lockedWhy ? 'checkout-locked' : 'checkout';
    var codAction = bar.lockedWhy ? 'checkout-locked' : 'cod';
    var checkoutBtn = cod.shown && codPlacement === 'replace' ? '' : '<button type="button" class="bxq-go' + (bar.lockedWhy ? ' is-locked' : '') + '" data-combo-action="' + goAction + '"' + lockAttrs + '>' + esc(label) + '</button>';
    var codBtn = cod.shown ? '<button type="button" class="bxq-cod' + (bar.lockedWhy ? ' is-locked' : '') + '" data-combo-action="' + codAction + '"' + lockAttrs + (cod.css ? ' style="' + esc(cod.css) + '"' : '') + '>' + (cod.icon || '') + esc(cod.text || 'Cash on Delivery') + '</button>' : '';
    return '<span class="bxq-actions' + (cod.shown ? ' has-cod' : '') + '">' + (codPlacement === 'below' ? checkoutBtn + codBtn : codBtn + checkoutBtn) + '</span>';
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

  // Same rule as combo-align.shared.js comboAlign: a saved phone 'left' is
  // the builder's old default unless set in the phone view.
  function alignOf(config, prefix, isMobile) {
    var valid = function (v) { return v === 'left' || v === 'center' || v === 'right'; };
    var desktop = valid(config[prefix + '_align']) ? config[prefix + '_align'] : 'left';
    if (!isMobile) return desktop;
    var phone = config[prefix + '_align_mobile'];
    if (valid(phone) && (config[prefix + '_align_mobile_set'] === true || phone !== 'left')) return phone;
    return desktop;
  }

  function textCss(config, prefix, isMobile, defaults) {
    var css = '';
    var align = alignOf(config, prefix, isMobile);
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
        var align = alignOf(config, 'heading', m);
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

  var ICON_X = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  /** The product popup: big picture with thumbnails, then name, price, options, description and Add. */
  function renderPopup(model) {
    var pop = model.popup;
    if (!pop) return '';
    var config = model.config;
    var card = pop.card;
    var imgs = card.images;
    var n = imgs.length;
    var html = '<div class="bxq-pop" role="dialog" aria-modal="true" aria-label="' + esc(card.title) + '">'
      + '<div class="bxq-pop-scrim" data-combo-action="qs-view-close"></div>'
      + '<div class="bxq-pop-box">'
      + '<button type="button" class="bxq-pop-close" data-combo-action="qs-view-close" aria-label="Close">' + ICON_X + '</button>'
      + '<div class="bxq-pop-gallery"><div class="bxq-pop-main">';
    if (n) {
      html += '<img src="' + esc(imgs[pop.index].url) + '" alt="' + esc(imgs[pop.index].alt) + '" />';
      if (n > 1) {
        html += '<button type="button" class="bxq-pop-nav is-prev" data-combo-action="qs-view-img" data-value="' + ((pop.index - 1 + n) % n) + '" aria-label="Previous picture">' + ICON_PREV + '</button>'
          + '<button type="button" class="bxq-pop-nav is-next" data-combo-action="qs-view-img" data-value="' + ((pop.index + 1) % n) + '" aria-label="Next picture">' + ICON_NEXT + '</button>'
          + '<span class="bxq-pop-count">' + (pop.index + 1) + ' / ' + n + '</span>';
      }
    } else {
      html += '<span class="bxq-noimg"></span>';
    }
    html += '</div>';
    if (n > 1) {
      html += '<div class="bxq-pop-thumbs">';
      for (var i = 0; i < n; i++) {
        html += '<button type="button" class="bxq-pop-thumb' + (i === pop.index ? ' is-on' : '') + '" data-combo-action="qs-view-img" data-value="' + i + '" aria-label="Picture ' + (i + 1) + '"' + (i === pop.index ? ' aria-current="true"' : '') + '>'
          + '<img src="' + esc(imgs[i].url) + '" alt="" /></button>';
      }
      html += '</div>';
    }
    html += '</div><div class="bxq-pop-info">';
    if (card.badge) html += '<span class="bxq-pop-badge">' + esc(card.badge) + '</span>';
    html += '<h3 class="bxq-pop-name">' + esc(card.title) + '</h3>';
    html += '<div class="bxq-price"><b>' + esc(card.price) + '</b>' + (card.compare && on(config, 'qs_show_compare') ? '<s>' + esc(card.compare) + '</s>' : '') + '</div>';
    if (card.off && on(config, 'qs_show_off')) html += '<div class="bxq-off"><span>' + card.off + '% OFF</span></div>';
    if (card.variants.length) {
      html += '<label class="bxq-variant"><select data-combo-action="variant-select" data-product-id="' + esc(card.id) + '" aria-label="Choose an option">';
      for (var j = 0; j < card.variants.length; j++) {
        var v = card.variants[j];
        html += '<option value="' + esc(v.id) + '"' + (v.on ? ' selected' : '') + (v.available ? '' : ' disabled') + '>' + esc(v.title) + (v.available ? '' : ' (sold out)') + '</option>';
      }
      html += '</select>' + ICON_DOWN + '</label>';
    } else if (card.weightText && on(config, 'qs_show_weight')) {
      html += '<div class="bxq-variant is-static">' + esc(card.weightText) + '</div>';
    }
    if (!card.counts && model.view.enabled) html += '<div class="bxq-nocount">Not part of the box offer</div>';
    // Add closes the popup (data-close-popup); once in the box, the stepper stays.
    var cta = renderCardCta(model, card);
    if (card.available && !card.qty) cta = cta.replace('<button type="button" class="bxq-cta"', '<button type="button" class="bxq-cta" data-close-popup="1"');
    html += '<div class="bxq-pop-cta">' + cta + '</div>';
    if (card.summary) html += '<p class="bxq-pop-desc">' + esc(card.summary) + '</p>';
    html += '</div></div></div>';
    return html;
  }

  /** The whole page as HTML (attributes data-combo-action drive it). */
  function render(model) {
    var config = model.config;
    wholeMoney = on(config, 'qs_hide_decimals');
    var html = '<div class="bxq' + (model.isMobile ? ' bxq--m' : '') + '" style="' + vars(config) + '">';
    html += renderBanner(model);
    html += renderHead(model);
    html += renderTop(model);
    var left = filtersOnLeft(model);
    if (left) {
      // Picture collection bar stays above; the rest in the left column.
      var pictures = [];
      for (var pc = 0; pc < model.row.chips.length; pc++) if (model.row.chips[pc].picture) pictures.push(model.row.chips[pc]);
      if (pictures.length) html += renderCollectionBar(pictures, config);
      html += '<div class="bxq-layout"><aside class="bxq-side" aria-label="Filters">' + renderSideFilters(model) + '</aside><div class="bxq-main">';
    } else {
      html += renderFilters(model);
      if (model.row.menus.length) {
        for (var i = 0; i < model.row.menus.length; i++) if (model.row.menus[i].open) html += '<div class="bxq-scrim" data-combo-action="qs-menu-close"></div>';
      }
    }
    if (model.empty) html += '<div class="bxq-empty">' + esc(model.empty) + '</div>';
    else if (model.sections) {
      var titleAlign = sideOf(config, 'qs_group_title_align');
      for (var sx = 0; sx < model.sections.length; sx++) {
        var section = model.sections[sx];
        html += '<section class="bxq-section" data-collection="' + esc(section.handle) + '">';
        if (section.title) html += '<h2 class="bxq-section-title" style="text-align:' + titleAlign + '">' + esc(section.title) + '</h2>';
        html += '<div class="bxq-grid">';
        for (var sk = 0; sk < section.cards.length; sk++) html += renderCard(model, section.cards[sk]);
        html += '</div></section>';
      }
    } else {
      html += '<div class="bxq-grid">';
      for (var c = 0; c < model.cards.length; c++) html += renderCard(model, model.cards[c]);
      html += '</div>';
    }
    if (!model.empty && model.more > 0) {
      html += '<div class="bxq-more-wrap"><button type="button" class="bxq-more" data-combo-action="qs-more">'
        + esc(cleanText(opt(config, 'qs_more_text'), 40) || DEFAULTS.qs_more_text) + ' <span class="bxq-more-n">(' + model.more + ')</span></button></div>';
    }
    if (left) html += '</div></div>';
    html += renderBar(model);
    html += renderPopup(model);
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
    if (action === 'qs-group') { ui.dd[menu] = value && ui.dd[menu] !== value ? value : ''; ui.menu = null; return true; }
    if (action === 'qs-clear') { ui.chip = 'all'; ui.instock = false; ui.dd = {}; ui.menu = null; return true; }
    if (action === 'qs-more') {
      var key = filterKey(ui);
      ui.pages = (ui.pagesFor === key ? Math.max(1, Math.floor(Number(ui.pages)) || 1) : 1) + 1;
      ui.pagesFor = key;
      ui.menu = null;
      return true;
    }
    if (action === 'qs-view') { ui.popup = el && el.getAttribute ? el.getAttribute('data-product-id') : null; ui.popupImage = 0; ui.menu = null; return true; }
    if (action === 'qs-view-close') { ui.popup = null; ui.popupImage = 0; return true; }
    if (action === 'qs-view-img') { ui.popupImage = Math.max(0, Math.round(Number(value)) || 0); return true; }
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
    filterGroups: filterGroups,
    filterGroupHandles: filterGroupHandles,
    memberHandles: memberHandles,
    pageExclusions: pageExclusions,
    EXTRA_HANDLE: EXTRA_HANDLE,
    groupMembers: groupMembers,
    mileSizes: mileSizes,
    weightFilter: weightFilter,
    rangeInput: rangeInput,
    placeMenus: placeMenus,
    applyRange: applyRange,
    weightRanges: weightRanges,
    labelLook: labelLook,
    canCheckout: canCheckout,
    barMessage: barMessage,
    buildModel: buildModel,
    render: render,
    maxPerProduct: maxPerProduct,
    pageSize: pageSize,
    productQty: productQty,
    productLimitMessage: productLimitMessage,
    applyUiAction: applyUiAction,
    ICON_NAMES: ICON_NAMES,
    TIER_ICON_ORDER: TIER_ICON_ORDER,
    iconName: iconName,
    svgIcon: svgIcon,
    httpsUrl: httpsUrl,
    collectionImage: collectionImage,
    alignOf: alignOf,
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
.bxq-top.is-sticky{position:sticky;top:var(--bxq-top-offset);z-index:998;transition:top .2s ease;}
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
.bxq-fill,.bxq-step-fill,.bxq-miles-fill,.bxq-slim-fill,.bxq-scrim,.bxq-pop-scrim{display:block!important;}
.bxq-fill{height:100%;background:var(--bxq-fill);border-radius:var(--bxq-top-r);transition:width .35s ease;}
.bxq-fill.is-done{background:var(--bxq-done);}
.bxq-tick{position:absolute;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;border:2px solid var(--bxq-track);}
.bxq-tick.is-hit{border-color:var(--bxq-done);background:var(--bxq-done);}
.bxq-ticks{position:relative;height:38px;margin-top:6px;}
.bxq--m .bxq-tick-label,.bxq--m .bxq-step-label{font-size:var(--bxq-lbl-fs-m,var(--bxq-lbl-fs,12px));}
.bxq-tick-label{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;white-space:nowrap;font-size:var(--bxq-lbl-fs,12px);line-height:1.3;}
.bxq-tick-label:last-child{transform:translateX(-100%);align-items:flex-end;}
.bxq-tick-label small,.bxq-step-label small,.bxq-mile-label small{opacity:.6;font-size:var(--bxq-lbl-sub,11px);}
.bxq-tick-label.is-hit b,.bxq-step.is-hit b,.bxq-mile.is-hit b{color:var(--bxq-done);}
.bxq-steps{display:flex;gap:6px;}
.bxq-step{flex:1;min-width:0;}
.bxq-step-track{height:var(--bxq-top-h);background:var(--bxq-track);border-radius:var(--bxq-top-r);overflow:hidden;}
.bxq-step-fill{height:100%;background:var(--bxq-fill);transition:width .35s ease;}
.bxq-step.is-hit .bxq-step-fill{background:var(--bxq-done);}
.bxq-step-label{display:flex;flex-direction:column;margin-top:6px;font-size:var(--bxq-lbl-fs,12px);line-height:1.3;}
.bxq-miles{position:relative;height:calc(var(--bxq-mile-dot,34px) + 40px);margin:0 max(50px,calc(var(--bxq-mile-dot,34px) / 2 + 4px));}
.bxq--m .bxq-miles{margin:0 max(38px,calc(var(--bxq-mile-dot,34px) / 2 + 4px));}
.bxq-miles-line{position:absolute;left:0;right:0;top:calc(var(--bxq-mile-dot,34px) / 2);height:var(--bxq-top-h);margin-top:calc(var(--bxq-top-h) / -2);background:var(--bxq-track);border-radius:var(--bxq-top-r);}
.bxq-miles-fill{height:100%;background:var(--bxq-fill);border-radius:var(--bxq-top-r);transition:width .35s ease;}
.bxq-mile{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;width:max(var(--bxq-mile-dot,34px),min(110px,calc(var(--bxq-mile-share,100%) - 6px)));text-align:center;}
.bxq-mile-dot{width:var(--bxq-mile-dot,34px);height:var(--bxq-mile-dot,34px);flex:0 0 auto;border-radius:50%;background:#fff;border:2px solid var(--bxq-track);display:flex;align-items:center;justify-content:center;font-size:16px;transition:transform .25s ease;}
.bxq-mile.is-next .bxq-mile-dot{border-color:var(--bxq-fill);}
.bxq-mile.is-hit .bxq-mile-dot{background:var(--bxq-done);border-color:var(--bxq-done);}
.bxq-mile-icon{width:var(--bxq-mile-icon,18px);height:var(--bxq-mile-icon,18px);object-fit:contain;display:block;}
.bxq-mile-dot{color:#6b7280;}
.bxq-mile.is-next .bxq-mile-dot{color:var(--bxq-fill);}
.bxq-mile.is-hit .bxq-mile-dot{color:#fff;}
.bxq-msg-icon{color:#fff;}
.bxq-msg-glyph{width:22px;height:22px;display:block;object-fit:contain;}
.bxq-mile-label{display:flex;flex-direction:column;margin-top:4px;font-size:var(--bxq-lbl-fs,12px);line-height:1.25;}
.bxq--m .bxq-mile{width:max(var(--bxq-mile-dot,34px),min(84px,calc(var(--bxq-mile-share,100%) - 4px)));}
.bxq-mile-label b{overflow-wrap:anywhere;}
.bxq--m .bxq-mile-label{font-size:var(--bxq-lbl-fs-mile-m,11px);}
.bxq-filters{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 14px;scrollbar-width:none;align-items:center;}
.bxq-filters::-webkit-scrollbar{display:none;}
.bxq-filters + .bxq-gchips{margin-top:-8px;}
.bxq-gchips-label{flex:0 0 auto;font-size:13px;font-weight:700;opacity:.7;}
.bxq--m .bxq-gchips-label{font-size:12px;}
.bxq-range{gap:12px;overflow:visible;}
.bxq-range-box{position:relative;flex:1 1 220px;min-width:140px;max-width:420px;height:28px;}
.bxq-range-track{position:absolute;left:10px;right:10px;top:12px;height:4px;border-radius:4px;background:rgba(0,0,0,.12);}
.bxq-range-fill{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--bxq-accent);display:block!important;}
.bxq-range-in{position:absolute;left:0;top:0;width:100%;height:28px;margin:0;padding:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none;}
.bxq-range-in:focus{outline:none;}
.bxq-range-in::-webkit-slider-runnable-track{height:28px;background:none;border:none;}
.bxq-range-in::-moz-range-track{background:none;border:none;}
.bxq-range-in::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;pointer-events:auto;width:20px;height:20px;margin-top:4px;border-radius:50%;background:#fff;border:2px solid var(--bxq-accent);box-shadow:0 1px 3px rgba(0,0,0,.25);cursor:pointer;}
.bxq-range-in::-moz-range-thumb{pointer-events:auto;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid var(--bxq-accent);box-shadow:0 1px 3px rgba(0,0,0,.25);cursor:pointer;}
.bxq-range-in:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--bxq-accent) 30%,transparent);}
.bxq-range-val{flex:0 0 auto;font-size:13px;font-weight:700;white-space:nowrap;opacity:.75;}
.bxq-range-val.is-on{opacity:1;color:var(--bxq-accent);}
.bxq-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;border:1.5px solid rgba(0,0,0,.12);background:#fff;border-radius:999px;padding:9px 18px;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap;color:var(--bxq-text) !important;}
.bxq--m .bxq-chip{padding:7px 13px;font-size:13.5px;}
.bxq-chip.is-on{border-color:var(--bxq-accent);background:color-mix(in srgb,var(--bxq-accent) 10%,#fff);color:var(--bxq-accent) !important;}
.bxq-chip--icon{padding:9px 14px;position:relative;}
.bxq-colbar{display:flex;gap:14px;overflow-x:auto;padding:4px 2px 12px;margin-bottom:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.bxq-colbar::-webkit-scrollbar{display:none;}
.bxq-al-center>:first-child,.bxq-al-right>:first-child{margin-left:auto;}
.bxq-al-center>:last-child{margin-right:auto;}
.bxq-section{margin:0 0 26px;}
.bxq-section-title{margin:6px 0 14px;font-size:var(--bxq-sec-fs,20px);line-height:1.25;font-weight:800;color:var(--bxq-text);}
.bxq--m .bxq-section{margin-bottom:20px;}
.bxq--m .bxq-section-title{font-size:var(--bxq-sec-fs-m,17px);margin:4px 0 10px;}
.bxq-col{flex:0 0 auto;width:calc(var(--bxq-col-size) + 16px);display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;margin:0;border:0;background:none;cursor:pointer;font:inherit;color:var(--bxq-text) !important;}
.bxq-col-img{width:var(--bxq-col-size);height:var(--bxq-col-size);border-radius:var(--bxq-col-r);overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.1);display:flex;align-items:center;justify-content:center;color:var(--bxq-accent);transition:box-shadow .15s;}
.bxq-col-img img{width:100%;height:100%;object-fit:cover;display:block;}
.bxq-col-letter{font-size:calc(var(--bxq-col-size) * .38);font-weight:800;}
.bxq-col.is-on .bxq-col-img{box-shadow:0 0 0 2.5px var(--bxq-accent);}
.bxq-col-name{max-width:100%;font-size:13px;font-weight:600;line-height:1.25;text-align:center;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.bxq-col.is-on .bxq-col-name{color:var(--bxq-accent) !important;}
.bxq--m .bxq-colbar{gap:10px;}
.bxq--m .bxq-col{width:calc(var(--bxq-col-size-m) + 12px);}
.bxq--m .bxq-col-img{width:var(--bxq-col-size-m);height:var(--bxq-col-size-m);}
.bxq--m .bxq-col-letter{font-size:calc(var(--bxq-col-size-m) * .38);}
.bxq--m .bxq-col-name{font-size:12px;}
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
.bxq-media img{width:100%;height:100%;object-fit:var(--bxq-fit,contain);display:block;}
.bxq-noimg{display:block;width:100%;height:100%;background:#eef0f3;}
.bxq-badge{position:absolute;left:0;right:0;bottom:0;padding:16px 10px 6px;font-size:13px;font-weight:800;color:#fff;background:linear-gradient(180deg,transparent,var(--bxq-badge) 70%);}
.bxq-add{position:absolute;top:8px;right:8px;width:44px;height:44px;border-radius:12px;border:2px solid var(--bxq-accent);background:#fff;color:var(--bxq-accent) !important;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.08);}
.bxq-add:hover{background:color-mix(in srgb,var(--bxq-accent) 8%,#fff);}
.bxq--m .bxq-add{width:36px;height:36px;border-radius:10px;}
.bxq-stepper{position:absolute;top:8px;right:8px;display:flex;align-items:center;background:var(--bxq-accent);color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.15);}
.bxq-stepper button{border:0;background:transparent;color:#fff !important;width:36px;height:40px;font-size:20px;font-weight:700;cursor:pointer;}
.bxq-stepper span{min-width:22px;text-align:center;font-weight:800;}
.bxq--m .bxq-stepper button{width:30px;height:34px;}
.bxq-card button[data-combo-action="qty-inc"]:disabled{opacity:.4;cursor:not-allowed;}
.bxq-soldout{position:absolute;top:8px;right:8px;background:rgba(17,24,39,.8);color:#fff;font-size:12px;font-weight:700;border-radius:8px;padding:5px 8px;}
.bxq-info{display:flex;flex-direction:column;gap:6px;padding:10px 2px 2px;flex:1;min-width:0;}
.bxq-eyebrow{font-size:12px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;opacity:.6;}
.bxq-name{margin:0;font-size:17px;line-height:1.3;font-weight:600;color:var(--bxq-text);}
.bxq--m .bxq-name{font-size:14px;}
.bxq-sub{margin:0;font-size:14px;line-height:1.4;opacity:.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bxq--m .bxq-sub{font-size:12.5px;}
.bxq-variant{position:relative;display:inline-flex;align-items:center;gap:4px;color:var(--bxq-accent);font-size:15px;align-self:flex-start;margin-top:4px;max-width:100%;min-width:0;}
.bxq-variant select{appearance:none;-webkit-appearance:none;border:0;background:transparent;font:inherit;color:var(--bxq-text);padding:2px 20px 2px 0;cursor:pointer;flex:0 1 auto;width:auto !important;min-width:0 !important;max-width:100% !important;height:auto;margin:0;box-shadow:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bxq-variant svg{position:absolute;right:0;pointer-events:none;}
.bxq-variant.is-static{color:var(--bxq-text);opacity:.75;}
.bxq-off{display:flex;align-items:center;gap:8px;color:var(--bxq-off);font-size:15px;font-weight:800;}
.bxq-off::after{content:"";flex:1;border-top:1.5px dashed rgba(0,0,0,.15);}
.bxq-price{display:flex;align-items:baseline;gap:8px;}
.bxq-price b{font-size:19px;font-weight:800;}
.bxq-price s{font-size:14px;opacity:.45;}
.bxq--m .bxq-price b{font-size:16px;}
.bxq-nocount{font-size:12px;opacity:.55;}
.bxq-cta{margin-top:auto;display:flex;align-items:center;justify-content:center;width:100%;min-height:42px;border:0;border-radius:calc(var(--bxq-radius) - 4px);background:var(--bxq-accent);color:#fff !important;font:inherit;font-size:15px;font-weight:700;cursor:pointer;}
.bxq-card--normal .bxq-price{margin-bottom:6px;}
.bxq-cta:hover{filter:brightness(.95);}
.bxq-cta.is-out{background:#e5e7eb;color:#6b7280 !important;cursor:not-allowed;}
.bxq-cta--stepper{justify-content:space-between;cursor:default;padding:0 4px;}
.bxq-cta--stepper button{border:0;background:transparent;color:#fff !important;width:40px;height:42px;font-size:20px;font-weight:700;cursor:pointer;}
.bxq-cta--stepper span{font-weight:800;}
.bxq--m .bxq-cta{min-height:36px;font-size:14px;}
.bxq--m .bxq-cta--stepper button{height:36px;width:34px;}
.bxq-more-wrap{display:flex;justify-content:center;margin:22px 0 8px;}
.bxq-more{border:1.5px solid var(--bxq-btn);background:var(--bxq-card);color:var(--bxq-btn);border-radius:999px;padding:11px 26px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;}
.bxq-more:hover{background:var(--bxq-btn);color:var(--bxq-btn-text);}
.bxq-more-n{font-weight:500;opacity:.75;}
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
.bxq-go,.bxq-cod{border:0;border-radius:var(--bxq-btn-r);padding:var(--bxq-btn-py,14px) var(--bxq-btn-px,26px);font-size:17px;font-weight:800;cursor:pointer;white-space:nowrap;}
.bxq .bxq-go{font-size:var(--bxq-btn-fs);}
.bxq-go{background:var(--bxq-btn);color:var(--bxq-btn-text) !important;}
.bxq-cod{background:#fff;border:1.5px solid var(--bxq-btn);color:var(--bxq-btn);display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.bxq--m .bxq-row{flex-wrap:wrap;}
.bxq--m .bxq-actions.has-cod{flex:1 1 100%;}
.bxq--m .bxq-actions.has-cod button{flex:1;}
.bxq--m .bxq-go,.bxq--m .bxq-cod{padding:var(--bxq-btn-py-m,12px) var(--bxq-btn-px-m,16px);font-size:var(--bxq-btn-fs-m,15px);}
.bxq-go:disabled,.bxq-cod:disabled,.bxq-go.is-locked,.bxq-cod.is-locked{opacity:.45;cursor:not-allowed;}
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
.bxq-media img[data-combo-action],.bxq-media .bxq-noimg[data-combo-action],.bxq-name[data-combo-action]{cursor:pointer;}
.bxq-name[data-combo-action]:hover{text-decoration:underline;text-underline-offset:3px;}
.bxq-pop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;}
.bxq-pop-scrim{position:absolute;inset:0;background:rgba(17,24,39,.55);animation:bxq-pop-fade .2s ease;}
.bxq-pop-box{position:relative;width:100%;max-width:900px;max-height:calc(100vh - 48px);overflow:auto;overscroll-behavior:contain;background:var(--bxq-card);color:var(--bxq-text);border-radius:var(--bxq-radius);box-shadow:0 20px 50px rgba(0,0,0,.25);display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:24px;padding:22px;animation:bxq-pop-in .22s ease;}
.bxq-pop-close{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.94);color:#111827 !important;box-shadow:0 1px 4px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;cursor:pointer;}
.bxq-pop-main{position:relative;aspect-ratio:var(--bxq-ratio);background:#f3f4f6;border-radius:calc(var(--bxq-radius) - 4px);overflow:hidden;}
.bxq-pop-main img{display:block;width:100%;height:100%;object-fit:contain;}
.bxq-pop-nav{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.92);color:#111827 !important;box-shadow:0 1px 4px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;cursor:pointer;}
.bxq-pop-nav.is-prev{left:10px;}
.bxq-pop-nav.is-next{right:10px;}
.bxq-pop-count{position:absolute;bottom:10px;right:10px;background:rgba(17,24,39,.65);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;}
.bxq-pop-gallery,.bxq-pop-info{min-width:0;}
.bxq-pop-thumbs{display:flex;gap:8px;margin-top:10px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin;}
.bxq-pop-thumb{flex:none;width:64px;height:64px;padding:0;border-radius:8px;border:2px solid transparent;background:#f3f4f6;overflow:hidden;cursor:pointer;opacity:.75;}
.bxq-pop-thumb.is-on{border-color:var(--bxq-accent);opacity:1;}
.bxq-pop-thumb img{display:block;width:100%;height:100%;object-fit:cover;}
.bxq-pop-info{display:flex;flex-direction:column;gap:10px;min-width:0;padding-top:4px;}
.bxq-pop-badge{align-self:flex-start;background:var(--bxq-badge);color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;}
.bxq-pop-name{margin:0;padding-right:40px;font-size:22px;line-height:1.3;font-weight:700;color:var(--bxq-text);}
.bxq-pop-info .bxq-price b{font-size:22px;}
.bxq-pop-cta{margin-top:4px;}
.bxq-pop-cta .bxq-cta{min-height:46px;}
.bxq-pop-desc{margin:4px 0 0;font-size:14.5px;line-height:1.6;opacity:.8;white-space:pre-line;overflow-wrap:anywhere;}
.bxq--m .bxq-pop{align-items:flex-end;padding:0;}
.bxq--m .bxq-pop-box{grid-template-columns:minmax(0,1fr);gap:14px;max-height:92vh;border-radius:18px 18px 0 0;padding:14px 14px 20px;animation:bxq-pop-up .25s ease;}
.bxq--m .bxq-pop-name{font-size:18px;}
.bxq--m .bxq-pop-thumb{width:54px;height:54px;}
@keyframes bxq-pop-fade{from{opacity:0;}to{opacity:1;}}
@keyframes bxq-pop-in{from{opacity:0;transform:translateY(10px) scale(.98);}to{opacity:1;transform:none;}}
@keyframes bxq-pop-up{from{transform:translateY(40px);opacity:.6;}to{transform:none;opacity:1;}}
@media (prefers-reduced-motion: reduce){.bxq-pop-scrim,.bxq-pop-box{animation:none !important;}}
[data-brix-combo-popup] .bxq-bar{position:fixed;left:12px;right:12px;bottom:12px;margin:0 auto;z-index:2147483646;}
.bxq--m[data-brix-combo-popup] .bxq-bar{left:8px;right:8px;bottom:8px;}
/* Icons keep their size on every theme. Themes often size every svg
   (svg{width:1em}) or anything with "icon" in its class, which shrank the
   milestone icons to a few px inside their circles. */
.bxq-mile-icon{width:var(--bxq-mile-icon,18px) !important;height:var(--bxq-mile-icon,18px) !important;min-width:0 !important;max-width:none !important;flex:0 0 auto;}
.bxq-msg-glyph{width:26px !important;height:26px !important;max-width:none !important;flex:0 0 auto;}
.bxq-mile-icon > svg,.bxq-msg-glyph > svg{display:block !important;width:100% !important;height:100% !important;min-width:0 !important;max-width:none !important;max-height:none !important;}
.bxq-add > svg{width:22px !important;height:22px !important;max-width:none !important;flex:0 0 auto;}
.bxq-chip > svg{width:16px !important;height:16px !important;max-width:none !important;flex:0 0 auto;}
.bxq-chip--icon > svg{width:20px !important;height:20px !important;}
/* Slots bar (quantity boxes). */
.bxq-bar--slots{padding-top:0;}
.bxq-slots-msg{margin:0 -16px 12px;padding:11px 14px;text-align:center;font-weight:700;font-size:15px;line-height:1.35;background:color-mix(in srgb,var(--bxq-bar-text) 4%,var(--bxq-bar-bg));border-bottom:1px solid rgba(0,0,0,.08);}
.bxq--m .bxq-slots-msg{margin:0 -12px 10px;padding:10px 12px;font-size:14px;}
.bxq-slots-msg.is-success{color:var(--bxq-save);}
.bxq-slots{display:flex;gap:10px;flex:1 1 auto;justify-content:center;min-width:0;}
.bxq--m .bxq-slots{gap:8px;flex:1 1 100%;}
.bxq-slot{position:relative;flex:0 0 auto;width:64px;height:64px;box-sizing:border-box;border-radius:12px;border:1.5px solid rgba(0,0,0,.14);background:#fff;display:flex;align-items:center;justify-content:center;color:rgba(0,0,0,.35);padding:0;overflow:hidden;}
.bxq--m .bxq-slot{width:56px;height:56px;}
.bxq-slot > svg{width:22px !important;height:22px !important;max-width:none !important;}
.bxq-slot.is-filled{border-color:var(--bxq-accent);cursor:pointer;}
.bxq-slot img{width:100%;height:100%;object-fit:contain;display:block;}
.bxq-slot-x{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:rgba(17,24,39,.65);color:#fff;font-size:14px;line-height:18px;text-align:center;}
.bxq-slot.is-more{font-weight:800;font-size:13px;color:var(--bxq-bar-text);}
.bxq--m .bxq-bar--slots .bxq-actions{flex:1 1 100%;}
.bxq--m .bxq-bar--slots .bxq-actions > *{flex:1 1 0;}
/* Card and filter text sizes (merchant settings; unset = the sizes above). */
.bxq-card .bxq-name{font-size:var(--bxq-title-fs,17px);}
.bxq--m .bxq-card .bxq-name{font-size:var(--bxq-title-fs-m,14px);}
.bxq-card .bxq-sub{font-size:var(--bxq-ctext-fs,14px);}
.bxq--m .bxq-card .bxq-sub{font-size:var(--bxq-ctext-fs-m,12.5px);}
.bxq-card .bxq-variant,.bxq-card .bxq-off{font-size:var(--bxq-ctext-fs,15px);}
.bxq--m .bxq-card .bxq-variant,.bxq--m .bxq-card .bxq-off{font-size:var(--bxq-ctext-fs-m,15px);}
.bxq-card .bxq-price b{font-size:var(--bxq-price-fs,19px);}
.bxq--m .bxq-card .bxq-price b{font-size:var(--bxq-price-fs-m,16px);}
.bxq-card .bxq-price s{font-size:var(--bxq-cmp-fs,14px);}
.bxq--m .bxq-card .bxq-price s{font-size:var(--bxq-cmp-fs-m,14px);}
.bxq-chip{font-size:var(--bxq-chip-fs,15px);}
.bxq--m .bxq-chip{font-size:var(--bxq-chip-fs-m,13.5px);}
.bxq-opt{font-size:var(--bxq-chip-fs,14px);}
.bxq--m .bxq-opt{font-size:var(--bxq-chip-fs-m,14px);}
/* A slider behind a chip. */
.bxq-menu--range{min-width:280px;padding:10px 14px;overflow:visible;}
.bxq-menu--range .bxq-range{padding:0;flex-wrap:wrap;gap:6px 12px;}
.bxq-menu--range .bxq-gchips-label{display:none;}
.bxq-menu--range .bxq-range-box{flex:1 1 100%;max-width:none;}
/* Filters in a left column (desktop). */
.bxq-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:20px;align-items:start;}
.bxq-side{background:var(--bxq-card);border-radius:var(--bxq-radius);padding:14px 14px 8px;box-shadow:0 1px 3px rgba(0,0,0,.06);}
.bxq-side-head{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:16px;margin:0 0 8px;}
.bxq-side-clear{border:0;background:none;padding:0;color:var(--bxq-accent) !important;font-weight:700;font-size:13px;cursor:pointer;}
.bxq-side-sec{border-top:1px solid rgba(0,0,0,.08);padding:10px 0 8px;}
.bxq-side-title{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.6;}
.bxq-side-opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;padding:6px 4px;border-radius:8px;font-size:var(--bxq-chip-fs,14px);cursor:pointer;color:var(--bxq-text) !important;}
.bxq-side-opt:hover{background:rgba(0,0,0,.04);}
.bxq-side-radio{flex:0 0 auto;width:16px;height:16px;border-radius:50%;border:2px solid rgba(0,0,0,.25);background:#fff;}
.bxq-side-check .bxq-side-radio{border-radius:4px;}
.bxq-side-opt.is-on{font-weight:700;color:var(--bxq-accent) !important;}
.bxq-side-opt.is-on .bxq-side-radio{border-color:var(--bxq-accent);background:var(--bxq-accent);box-shadow:inset 0 0 0 3px #fff;}
.bxq-side .bxq-range{padding:0;flex-wrap:wrap;gap:4px 10px;}
.bxq-side .bxq-range .bxq-gchips-label{display:none;}
.bxq-side .bxq-range-box{flex:1 1 100%;max-width:none;min-width:0;}
@media (prefers-reduced-motion: reduce){.bxq-fill,.bxq-step-fill,.bxq-miles-fill,.bxq-slim-fill,.bxq-ring-fg{transition:none;}.bxq-bar.is-celebrate .bxq-msg-icon,.bxq-bar.is-celebrate .bxq-msg{animation:none;}}
`;
