// Cart drawer footer extras: the "Cards" row (payment logos or typed text) and
// the "Trust badges" row (icon + title + line under the Checkout button).
//
// One copy of the rules and the HTML: createFooterExtras() is plain ES5 with no
// imports, so its source is embedded verbatim in cart_drawer_inline.js between
// `footer-extras:begin/end` (checked by tests/cart-drawer/footer-extras.test.mjs)
// and the Cart Editor preview draws the same HTML.
//
// Saved inside the legacy `cart_drawer.checkout_button_style` JSON as
// `paymentCards` / `trustBadges` (the storefront's own source for the footer).
export function createFooterExtras() {
  var HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var MAX_CARDS = 8;
  var MAX_BADGES = 4;

  var ICONS = {
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    returns: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    card: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
    support: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>'
  };
  var ICON_OPTIONS = [
    { label: 'Truck (shipping)', value: 'truck' },
    { label: 'Returns', value: 'returns' },
    { label: 'Shield (secure)', value: 'shield' },
    { label: 'Lock', value: 'lock' },
    { label: 'Gift', value: 'gift' },
    { label: 'Star', value: 'star' },
    { label: 'Heart', value: 'heart' },
    { label: 'Clock', value: 'clock' },
    { label: 'Tick', value: 'check' },
    { label: 'Package', value: 'package' },
    { label: 'Card', value: 'card' },
    { label: 'Support', value: 'support' }
  ];

  // Built-in card logos, drawn small (48 x 30) as SVG so nothing is fetched.
  var F = 'font-family="Arial,Helvetica,sans-serif" font-weight="700"';
  var CARD_BODY = {
    visa: '<text x="24" y="20" text-anchor="middle" font-size="14" font-style="italic" fill="#1a1f71" ' + F + '>VISA</text>',
    mastercard: '<circle cx="19" cy="15" r="8" fill="#eb001b"/><circle cx="29" cy="15" r="8" fill="#f79e1b" fill-opacity=".9"/>',
    amex: '<rect x="4" y="5" width="40" height="20" rx="2" fill="#2e77bb"/><text x="24" y="19" text-anchor="middle" font-size="9" fill="#fff" ' + F + '>AMEX</text>',
    rupay: '<text x="24" y="19" text-anchor="middle" font-size="10" ' + F + '><tspan fill="#1c4aa3">Ru</tspan><tspan fill="#f58220">Pay</tspan></text>',
    upi: '<text x="24" y="19" text-anchor="middle" font-size="12" font-style="italic" fill="#3d3d3d" ' + F + '>UPI</text>',
    paypal: '<text x="24" y="19" text-anchor="middle" font-size="10" font-style="italic" ' + F + '><tspan fill="#253b80">Pay</tspan><tspan fill="#179bd7">Pal</tspan></text>',
    applepay: '<text x="24" y="19" text-anchor="middle" font-size="9" fill="#111" ' + F + '>Apple Pay</text>',
    gpay: '<text x="24" y="19" text-anchor="middle" font-size="10" ' + F + '><tspan fill="#4285f4">G</tspan><tspan fill="#5f6368"> Pay</tspan></text>'
  };
  var BRAND_OPTIONS = [
    { label: 'Visa', value: 'visa' },
    { label: 'Mastercard', value: 'mastercard' },
    { label: 'American Express', value: 'amex' },
    { label: 'RuPay', value: 'rupay' },
    { label: 'UPI', value: 'upi' },
    { label: 'PayPal', value: 'paypal' },
    { label: 'Apple Pay', value: 'applepay' },
    { label: 'Google Pay', value: 'gpay' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function num(v, def, min, max) {
    var n = parseFloat(v);
    if (!isFinite(n)) return def;
    return Math.max(min, Math.min(max, Math.round(n)));
  }
  function hex(v, def) { return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : def; }
  // '' is a real choice for backgrounds ("none").
  function hexOrEmpty(v, def) {
    if (v === '' || v === null) return '';
    return hex(v, def);
  }
  function https(v) {
    var s = typeof v === 'string' ? v.trim() : '';
    return /^https:\/\//i.test(s) && s.length <= 2000 ? s : '';
  }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function id() { return 'f' + Math.random().toString(36).slice(2, 8); }
  var JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

  function defaultCards() {
    return {
      enabled: false,
      align: 'left',
      height: 26,
      gap: 8,
      marginTop: 10,
      textSize: 12,
      textColor: '#374151',
      textBg: '#f3f4f6',
      items: [
        { id: 'c1', type: 'brand', brand: 'visa' },
        { id: 'c2', type: 'brand', brand: 'mastercard' }
      ]
    };
  }
  function defaultTrust() {
    return {
      enabled: false,
      layout: 'stacked',
      iconSize: 26,
      iconColor: '#111827',
      titleSize: 11,
      titleColor: '#111827',
      titleBold: true,
      subSize: 10,
      subColor: '#6b7280',
      bgColor: '',
      borderColor: '',
      radius: 8,
      padding: 10,
      gap: 8,
      marginTop: 14,
      items: [
        { id: 't1', icon: 'truck', title: 'Free Shipping', subtitle: 'No Extra Costs' },
        { id: 't2', icon: 'returns', title: 'Easy Returns', subtitle: 'Return with Ease' },
        { id: 't3', icon: 'shield', title: 'Secure Checkout', subtitle: 'Secure Payment' }
      ]
    };
  }

  // Saved JSON (or nothing) -> a full, checked config. Missing keys = defaults.
  function cardsConfig(raw) {
    var d = defaultCards();
    var r = raw && typeof raw === 'object' ? raw : {};
    var items = [];
    var src = Array.isArray(r.items) ? r.items : d.items;
    for (var i = 0; i < src.length && items.length < MAX_CARDS; i++) {
      var it = src[i] || {};
      var type = pick(it.type, ['brand', 'image', 'text'], 'brand');
      if (type === 'brand') {
        if (!CARD_BODY[it.brand]) continue;
        items.push({ id: String(it.id || id()), type: 'brand', brand: it.brand });
      } else if (type === 'image') {
        var src2 = https(it.src);
        if (!src2) continue;
        items.push({ id: String(it.id || id()), type: 'image', src: src2 });
      } else {
        var text = String(it.text == null ? '' : it.text).slice(0, 24).trim();
        if (!text) continue;
        items.push({ id: String(it.id || id()), type: 'text', text: text });
      }
    }
    return {
      enabled: r.enabled === true || r.enabled === 1 || r.enabled === '1',
      align: pick(r.align, ['left', 'center', 'right'], d.align),
      height: num(r.height, d.height, 14, 48),
      gap: num(r.gap, d.gap, 2, 24),
      marginTop: num(r.marginTop, d.marginTop, 0, 40),
      textSize: num(r.textSize, d.textSize, 9, 20),
      textColor: hex(r.textColor, d.textColor),
      textBg: hexOrEmpty(r.textBg === undefined ? d.textBg : r.textBg, d.textBg),
      items: items
    };
  }
  function trustConfig(raw) {
    var d = defaultTrust();
    var r = raw && typeof raw === 'object' ? raw : {};
    var items = [];
    var src = Array.isArray(r.items) ? r.items : d.items;
    for (var i = 0; i < src.length && items.length < MAX_BADGES; i++) {
      var it = src[i] || {};
      var title = String(it.title == null ? '' : it.title).slice(0, 40).trim();
      var subtitle = String(it.subtitle == null ? '' : it.subtitle).slice(0, 60).trim();
      var image = https(it.iconImage);
      if (!title && !subtitle && !image) continue;
      items.push({
        id: String(it.id || id()),
        icon: ICONS[it.icon] ? it.icon : 'check',
        iconImage: image,
        title: title,
        subtitle: subtitle
      });
    }
    return {
      enabled: r.enabled === true || r.enabled === 1 || r.enabled === '1',
      layout: pick(r.layout, ['stacked', 'inline'], d.layout),
      iconSize: num(r.iconSize, d.iconSize, 12, 56),
      iconColor: hex(r.iconColor, d.iconColor),
      titleSize: num(r.titleSize, d.titleSize, 8, 20),
      titleColor: hex(r.titleColor, d.titleColor),
      titleBold: r.titleBold === undefined ? d.titleBold : r.titleBold !== false,
      subSize: num(r.subSize, d.subSize, 8, 18),
      subColor: hex(r.subColor, d.subColor),
      bgColor: hexOrEmpty(r.bgColor === undefined ? d.bgColor : r.bgColor, d.bgColor),
      borderColor: hexOrEmpty(r.borderColor === undefined ? d.borderColor : r.borderColor, d.borderColor),
      radius: num(r.radius, d.radius, 0, 24),
      padding: num(r.padding, d.padding, 0, 24),
      gap: num(r.gap, d.gap, 0, 32),
      marginTop: num(r.marginTop, d.marginTop, 0, 40),
      items: items
    };
  }

  function iconSvg(name, size, color) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;flex-shrink:0;">' + (ICONS[name] || ICONS.check) + '</svg>';
  }
  function brandSvg(brand, height) {
    var w = Math.round(height * 1.6);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 30" width="' + w + '" height="' + height + '" role="img" aria-label="' + esc(brand) + '" style="display:block;">'
      + '<rect x=".5" y=".5" width="47" height="29" rx="4" fill="#fff" stroke="#d1d5db"/>' + CARD_BODY[brand] + '</svg>';
  }

  // cfg must come from cardsConfig(). '' when off or empty.
  function cardsHtml(cfg) {
    if (!cfg || !cfg.enabled || !cfg.items.length) return '';
    var h = cfg.height;
    var out = '<div class="cc-pay-cards" data-cc-section="payment-cards" style="display:flex;flex-wrap:wrap;align-items:center;gap:' + cfg.gap + 'px;justify-content:' + JUSTIFY[cfg.align] + ';margin-top:' + cfg.marginTop + 'px;">';
    for (var i = 0; i < cfg.items.length; i++) {
      var it = cfg.items[i];
      if (it.type === 'brand') {
        out += '<span class="cc-pay-card" style="display:inline-flex;">' + brandSvg(it.brand, h) + '</span>';
      } else if (it.type === 'image') {
        out += '<img class="cc-pay-card" src="' + esc(it.src) + '" alt="" loading="lazy" style="height:' + h + 'px;width:auto;max-width:96px;object-fit:contain;display:block;">';
      } else {
        out += '<span class="cc-pay-card cc-pay-card--text" style="display:inline-flex;align-items:center;height:' + h + 'px;padding:0 10px;box-sizing:border-box;border-radius:4px;font-size:' + cfg.textSize + 'px;font-weight:600;line-height:1;white-space:nowrap;color:' + cfg.textColor + ';' + (cfg.textBg ? 'background:' + cfg.textBg + ';' : '') + '">' + esc(it.text) + '</span>';
      }
    }
    return out + '</div>';
  }

  // cfg must come from trustConfig(). '' when off or empty.
  function trustHtml(cfg) {
    if (!cfg || !cfg.enabled || !cfg.items.length) return '';
    var stacked = cfg.layout === 'stacked';
    var box = 'display:flex;gap:' + cfg.gap + 'px;margin-top:' + cfg.marginTop + 'px;padding:' + cfg.padding + 'px;border-radius:' + cfg.radius + 'px;'
      + (cfg.bgColor ? 'background:' + cfg.bgColor + ';' : '') + (cfg.borderColor ? 'border:1px solid ' + cfg.borderColor + ';' : '');
    var out = '<div class="cc-trust" data-cc-section="trust-badges" style="' + box + '">';
    for (var i = 0; i < cfg.items.length; i++) {
      var it = cfg.items[i];
      var icon = it.iconImage
        ? '<img src="' + esc(it.iconImage) + '" alt="" width="' + cfg.iconSize + '" height="' + cfg.iconSize + '" loading="lazy" style="width:' + cfg.iconSize + 'px;height:' + cfg.iconSize + 'px;object-fit:contain;display:block;flex-shrink:0;">'
        : iconSvg(it.icon, cfg.iconSize, cfg.iconColor);
      out += '<div class="cc-trust-item" style="flex:1 1 0;min-width:0;display:flex;' + (stacked ? 'flex-direction:column;align-items:center;text-align:center;' : 'flex-direction:row;align-items:center;text-align:left;justify-content:center;') + 'gap:' + (stacked ? 4 : 8) + 'px;">'
        + icon
        + '<div style="min-width:0;">'
        + (it.title ? '<div style="font-size:' + cfg.titleSize + 'px;font-weight:' + (cfg.titleBold ? 700 : 500) + ';line-height:1.25;color:' + cfg.titleColor + ';">' + esc(it.title) + '</div>' : '')
        + (it.subtitle ? '<div style="font-size:' + cfg.subSize + 'px;line-height:1.25;margin-top:1px;color:' + cfg.subColor + ';">' + esc(it.subtitle) + '</div>' : '')
        + '</div></div>';
    }
    return out + '</div>';
  }

  return {
    MAX_CARDS: MAX_CARDS,
    MAX_BADGES: MAX_BADGES,
    ICON_OPTIONS: ICON_OPTIONS,
    BRAND_OPTIONS: BRAND_OPTIONS,
    defaultCards: defaultCards,
    defaultTrust: defaultTrust,
    cardsConfig: cardsConfig,
    trustConfig: trustConfig,
    cardsHtml: cardsHtml,
    trustHtml: trustHtml,
    iconSvg: iconSvg,
    brandSvg: brandSvg
  };
}

export const footerExtras = createFooterExtras();
