/* BRIX COD Checkout - storefront sheet (see CLAUDE.md, "BRIX COD Checkout").
 *
 * One Cash-on-Delivery flow shared by three entry points:
 *   - cart drawer   (cart_drawer_inline.js -> BrixCod.mountDrawerButton)
 *   - product page  (auto-injected under Add to Cart, or into the
 *                    "COD button" app block's [data-brix-cod-slot])
 *   - combo pages   (combo-page.js / preview iframe -> BrixCod.open)
 *
 * Flow: phone (+ OTP when the store has SMS set up) -> address -> review
 * (priced by Shopify on our server) -> order placed in Shopify as
 * "Payment pending", tagged COD. Prepaid is never handled here: "Pay online"
 * always hands back to the caller's normal checkout path.
 *
 * Where data comes from:
 *   - COD settings and PIN code lookups: the BRIX PHP backend
 *     (php_backend/cod_storefront.php on data-php), like the cart drawer's
 *     own settings.
 *   - OTP, pricing and placing the order: the BRIX app server (data-api),
 *     the only place holding the store's Shopify access.
 *
 * Every server call re-checks the merchant's rules; anything shown here
 * before that (min/max hints) is only a hint.
 */
(function () {
  'use strict';
  if (window.BrixCod) return;

  var script = document.currentScript;
  var API = ((script && script.getAttribute('data-api')) || 'https://cartdrawer.fly.dev').replace(/\/$/, '');
  var PHP_API = ((script && script.getAttribute('data-php')) || 'https://int.thebrix.io').replace(/\/$/, '');
  var SHOP = (script && script.getAttribute('data-shop')) || (window.Shopify && window.Shopify.shop) || '';
  var CURRENCY = (script && script.getAttribute('data-currency')) || 'INR';
  var ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var CONFIG_KEY = 'brix_cod_config_v2';
  var ADDRESS_KEY = 'brix_cod_address_v1';
  var TOKEN_KEY = 'brix_cod_token_v1';

  var STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  /* ---------- small utils ---------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function readStore(kind, key) {
    try { var s = store(kind); var raw = s && s.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeStore(kind, key, value) {
    try { var s = store(kind); if (s) { if (value == null) s.removeItem(key); else s.setItem(key, JSON.stringify(value)); } } catch (e) { /* storage blocked */ }
  }
  function normalizePhone(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }
  function idemKey() {
    var a = '';
    for (var i = 0; i < 4; i++) a += Math.random().toString(36).slice(2, 10);
    return ('cod' + Date.now().toString(36) + a).slice(0, 48);
  }
  function moneyFormatter(code) {
    var nf = null;
    try { nf = new Intl.NumberFormat(document.documentElement.lang || 'en-IN', { style: 'currency', currency: code || 'INR' }); } catch (e) { nf = null; }
    return function (n) { n = Number(n) || 0; return nf ? nf.format(n) : (code || '') + ' ' + n.toFixed(2); };
  }

  function api(path, body) {
    var init = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ shop: SHOP }, body)) }
      : { method: 'GET' };
    var url = API + path + (body ? '' : (path.indexOf('?') === -1 ? '?' : '&') + 'shop=' + encodeURIComponent(SHOP));
    return window.fetch(url, init).then(function (res) {
      return res.json().catch(function () { return { success: false, error: 'Something went wrong. Please try again.' }; });
    }, function () {
      return { success: false, code: 'network', error: "We couldn't connect. Check your internet and try again." };
    });
  }

  // Public reads from php_backend/cod_storefront.php.
  function phpGet(action, params) {
    var url = PHP_API + '/cod_storefront.php?action=' + action + '&shop=' + encodeURIComponent(SHOP) + (params || '');
    return window.fetch(url, { method: 'GET' }).then(function (res) {
      return res.json().catch(function () { return { success: false }; });
    }, function () { return { success: false, code: 'network' }; });
  }

  /* ---------- config ---------- */

  var configPromise = null;
  var configValue;

  function loadConfig() {
    if (configPromise) return configPromise;
    var cached = readStore('sessionStorage', CONFIG_KEY);
    if (cached && cached.shop === SHOP && cached.expiresAt > Date.now()) {
      configValue = cached.config;
      configPromise = Promise.resolve(configValue);
      return configPromise;
    }
    if (!SHOP) { configValue = null; configPromise = Promise.resolve(null); return configPromise; }
    configPromise = phpGet('config').then(function (json) {
      configValue = json && json.success && json.enabled ? Object.assign({ currency: CURRENCY }, json) : null;
      writeStore('sessionStorage', CONFIG_KEY, { shop: SHOP, config: configValue, expiresAt: Date.now() + 60000 });
      return configValue;
    });
    return configPromise;
  }

  function isAvailable(surface) {
    return loadConfig().then(function (cfg) { return Boolean(cfg && cfg.enabled && (!surface || cfg.surfaces[surface] !== false)); });
  }

  function cartHasCheckoutOnlyLines(cart) {
    return (cart.items || []).some(function (item) {
      var p = item.properties || {};
      return Boolean(p._brix_pack_id) || p._brixReward === 'true' || p._brixReward === true;
    });
  }

  function fetchCart() {
    return window.fetch(ROOT + 'cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }

  function cartItems(cart) {
    return (cart.items || []).map(function (item) {
      return { variantId: item.variant_id, quantity: item.quantity, properties: item.properties || {} };
    });
  }

  /* ---------- sheet UI ---------- */

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:inherit}',
    '.ov{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s}',
    '.ov.on{opacity:1}',
    '.sh{background:#fff;color:#111827;width:100%;max-width:460px;max-height:92vh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;transform:translateY(24px);transition:transform .22s;font-size:15px;line-height:1.45;box-shadow:0 -10px 40px rgba(0,0,0,.2)}',
    '.ov.on .sh{transform:none}',
    '@media (min-width:640px){.ov{align-items:center}.sh{border-radius:16px}}',
    '.hd{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #eef0f3}',
    '.hd .t{flex:1;font-weight:700;font-size:16px}',
    '.ib{background:none;border:0;cursor:pointer;color:#111827;font-size:20px;line-height:1;padding:4px 6px;border-radius:8px}',
    '.ib:focus-visible,.b:focus-visible,input:focus-visible,select:focus-visible,.lk:focus-visible{outline:2px solid #2563eb;outline-offset:2px}',
    '.tag{font-size:11px;font-weight:700;letter-spacing:.04em;background:#ecfdf3;color:#067647;padding:3px 8px;border-radius:99px}',
    '.steps{display:flex;gap:6px;padding:12px 18px 0}',
    '.steps i{flex:1;height:4px;border-radius:4px;background:#e5e7eb}',
    '.steps i.on{background:var(--cod-bg,#111827)}',
    '.bd{padding:16px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:12px}',
    '.ft{padding:14px 18px 18px;border-top:1px solid #eef0f3;display:flex;flex-direction:column;gap:8px}',
    '.f{display:flex;flex-direction:column;gap:5px}',
    '.f label{font-size:12.5px;font-weight:600;color:#4b5563}',
    'input,select{font:inherit;font-size:16px;color:#111827;background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:11px 12px;width:100%}',
    '.pre{display:flex;border:1px solid #d1d5db;border-radius:10px;overflow:hidden}',
    '.pre span{padding:11px 10px;background:#f3f4f6;font-size:15px;display:flex;align-items:center;color:#374151}',
    '.pre input{border:0;border-radius:0}',
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.otp{font-size:24px;letter-spacing:.5em;text-align:center;font-variant-numeric:tabular-nums}',
    '.b{font:inherit;font-weight:700;font-size:15px;border-radius:12px;padding:14px 16px;border:1px solid transparent;cursor:pointer;width:100%;display:flex;justify-content:center;align-items:center;gap:8px}',
    '.b.p{background:var(--cod-bg,#111827);color:var(--cod-fg,#fff)}',
    '.b.s{background:#fff;color:#111827;border-color:#d1d5db}',
    '.b:disabled{opacity:.5;cursor:not-allowed}',
    '.lk{background:none;border:0;padding:0;font:inherit;color:#2563eb;font-weight:600;cursor:pointer;text-decoration:underline}',
    '.n{font-size:13px;padding:10px 12px;border-radius:10px;line-height:1.4}',
    '.n.ok{background:#ecfdf3;color:#067647}',
    '.n.er{background:#fef3f2;color:#b42318}',
    '.n.in{background:#eff6ff;color:#1e40af}',
    '.n.wa{background:#fffaeb;color:#93370d}',
    '.mu{color:#6b7280;font-size:13px}',
    '.li{display:grid;grid-template-columns:44px 1fr auto;gap:10px;align-items:center}',
    '.li img,.li .ph{width:44px;height:44px;border-radius:8px;object-fit:cover;background:#f3f4f6}',
    '.li .nm{font-weight:600;font-size:14px}',
    '.rows{display:flex;flex-direction:column;gap:6px;font-size:14px}',
    '.rows div{display:flex;justify-content:space-between;gap:12px}',
    '.rows .tot{font-weight:800;font-size:16px;border-top:1px dashed #d1d5db;padding-top:8px;margin-top:2px}',
    '.num{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.st{text-decoration:line-through;color:#9ca3af;font-weight:400;margin-right:6px}',
    '.done{align-items:center;text-align:center;padding:28px 18px}',
    '.tick{width:60px;height:60px;border-radius:50%;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:30px;font-weight:700}',
    '.big{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums}',
    '.sp{width:22px;height:22px;border-radius:50%;border:3px solid #e5e7eb;border-top-color:var(--cod-bg,#111827);animation:r .7s linear infinite}',
    '.ld{padding:48px 18px;display:flex;flex-direction:column;align-items:center;gap:12px;color:#6b7280}',
    '@keyframes r{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){.ov,.sh{transition:none}.sp{animation-duration:2s}}'
  ].join('');

  var sheet = null; // the one open sheet

  function Sheet(opts, cfg) {
    this.opts = opts;
    this.cfg = cfg;
    this.fmt = moneyFormatter(cfg.currency);
    this.items = opts.items || [];
    this.coupon = cfg.allowCoupons && opts.coupon ? String(opts.coupon) : null;
    this.addr = readStore('localStorage', ADDRESS_KEY) || {};
    this.phone = this.addr.phone || '';
    var saved = readStore('sessionStorage', TOKEN_KEY);
    this.token = saved && saved.shop === SHOP && saved.expiresAt > Date.now() ? saved : null;
    this.idem = idemKey();
    this.busy = false;
    this.pin = null; // last PIN lookup result
    this.build();
  }

  Sheet.prototype.build = function () {
    var host = document.createElement('div');
    host.setAttribute('data-brix-cod-sheet', '');
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    shadow.innerHTML = '<style>' + CSS + '</style><div class="ov" part="overlay"><div class="sh" role="dialog" aria-modal="true" aria-label="Cash on Delivery checkout"></div></div>';
    this.host = host;
    this.shadow = shadow;
    this.ov = shadow.querySelector('.ov');
    this.sh = shadow.querySelector('.sh');
    this.sh.style.setProperty('--cod-bg', this.cfg.buttons.bg);
    this.sh.style.setProperty('--cod-fg', this.cfg.buttons.color);
    document.body.appendChild(host);
    this.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    var self = this;
    this.ov.addEventListener('click', function (e) { if (e.target === self.ov && !self.busy) self.close(); });
    this.onKey = function (e) { if (e.key === 'Escape' && !self.busy) self.close(); };
    document.addEventListener('keydown', this.onKey);
    this.sh.addEventListener('click', function (e) { self.onClick(e); });
    this.sh.addEventListener('submit', function (e) { e.preventDefault(); self.onSubmit(e); });
    this.sh.addEventListener('input', function (e) { self.onInput(e); });
    requestAnimationFrame(function () { requestAnimationFrame(function () { self.ov.classList.add('on'); }); });
  };

  Sheet.prototype.close = function () {
    var self = this;
    this.ov.classList.remove('on');
    document.removeEventListener('keydown', this.onKey);
    document.documentElement.style.overflow = this.prevOverflow || '';
    setTimeout(function () { if (self.host.parentNode) self.host.parentNode.removeChild(self.host); }, 220);
    if (sheet === this) sheet = null;
    if (this.placed && typeof this.opts.onClosedAfterOrder === 'function') {
      try { this.opts.onClosedAfterOrder(this.placed); } catch (e) { /* caller UI only */ }
    }
  };

  Sheet.prototype.otpFlow = function () { return Boolean(this.cfg.otpRequired); };

  Sheet.prototype.frame = function (title, back, step, body, foot) {
    var total = this.otpFlow() ? 3 : 2;
    var current = this.otpFlow() ? step : Math.max(1, step - 1);
    var steps = '';
    if (step) { steps = '<div class="steps" aria-hidden="true">'; for (var i = 1; i <= total; i++) steps += '<i class="' + (i <= current ? 'on' : '') + '"></i>'; steps += '</div>'; }
    this.sh.innerHTML =
      '<div class="hd">' + (back ? '<button type="button" class="ib" data-go="' + back + '" aria-label="Back">&#8592;</button>' : '') +
      '<div class="t">' + esc(title) + '</div><span class="tag">COD</span>' +
      '<button type="button" class="ib" data-act="close" aria-label="Close">&#10005;</button></div>' + steps +
      '<form novalidate style="display:contents"><div class="bd">' + body + '</div>' + (foot ? '<div class="ft">' + foot + '</div>' : '') + '</form>';
    var first = this.sh.querySelector('[data-autofocus]');
    if (first && window.innerWidth >= 640) { try { first.focus(); } catch (e) { /* ignore */ } }
  };

  Sheet.prototype.loading = function (text) {
    this.sh.innerHTML = '<div class="hd"><div class="t">Cash on Delivery</div><span class="tag">COD</span><button type="button" class="ib" data-act="close" aria-label="Close">&#10005;</button></div>' +
      '<div class="ld" role="status"><div class="sp"></div><div>' + esc(text || 'Loading\u2026') + '</div></div>';
  };

  Sheet.prototype.payOnlineButton = function (label) {
    return typeof this.opts.onPayOnline === 'function'
      ? '<button type="button" class="b s" data-act="online">' + esc(label || 'Pay online instead') + '</button>'
      : '';
  };

  Sheet.prototype.fail = function (message) {
    this.frame('Cash on Delivery', null, 0,
      '<div class="n er" role="alert">' + esc(message || 'Something went wrong. Please try again.') + '</div>',
      this.payOnlineButton('Pay online') + '<button type="button" class="b s" data-act="close">Close</button>');
  };

  Sheet.prototype.setError = function (message) {
    var slot = this.sh.querySelector('[data-err]');
    if (slot) slot.innerHTML = message ? '<div class="n er" role="alert">' + esc(message) + '</div>' : '';
  };

  Sheet.prototype.setBusy = function (busy, label) {
    this.busy = busy;
    var btn = this.sh.querySelector('button[type="submit"]');
    if (btn) {
      if (busy) { btn.setAttribute('data-label', btn.innerHTML); btn.innerHTML = '<span class="sp" style="width:18px;height:18px;border-width:2px;border-top-color:currentColor"></span> ' + esc(label || 'Please wait\u2026'); }
      else if (btn.getAttribute('data-label')) btn.innerHTML = btn.getAttribute('data-label');
      btn.disabled = busy;
    }
  };

  /* --- start: a first quote without address fails fast on min/max, sold out, excluded products --- */
  Sheet.prototype.start = function () {
    var self = this;
    this.loading('Checking Cash on Delivery\u2026');
    api('/api/cod/quote', { surface: this.opts.surface, items: this.items, coupon: this.coupon }).then(function (json) {
      if (!json.success) { self.fail(json.error); return; }
      self.quote = json.quote;
      self.go(self.otpFlow() && !self.validToken() ? 'phone' : 'address');
    });
  };

  Sheet.prototype.validToken = function () {
    return this.token && this.token.expiresAt > Date.now() && this.token.phone === this.phone;
  };

  Sheet.prototype.go = function (view) {
    this.view = view;
    if (view === 'phone') return this.viewPhone();
    if (view === 'otp') return this.viewOtp();
    if (view === 'address') return this.viewAddress();
    if (view === 'review') return this.viewReview();
  };

  Sheet.prototype.viewPhone = function () {
    this.frame('Confirm your phone', null, 1,
      '<p style="margin:0">We\'ll send a 4-digit code by SMS to confirm this Cash on Delivery order.</p>' +
      '<div class="f"><label for="cod-phone">Mobile number</label><div class="pre"><span>+91</span>' +
      '<input id="cod-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="' + esc(this.phone) + '" data-autofocus></div></div>' +
      '<div data-err></div>',
      '<button type="submit" class="b p">Send code</button>' + this.payOnlineButton());
    this.submitAction = 'send';
  };

  Sheet.prototype.viewOtp = function () {
    this.frame('Enter the code', 'phone', 2,
      '<p style="margin:0">Sent to +91 ' + esc(this.phone) + '. <button type="button" class="lk" data-go="phone">Change</button></p>' +
      '<div class="f"><label for="cod-otp">4-digit code</label><input id="cod-otp" name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="4" data-autofocus></div>' +
      '<div data-err></div><p class="mu" style="margin:0" data-resend></p>',
      '<button type="submit" class="b p">Verify</button>');
    this.submitAction = 'verify';
    this.startResendTimer();
  };

  Sheet.prototype.startResendTimer = function () {
    var self = this;
    var left = this.resendAfter || 30;
    clearInterval(this.resendTimer);
    function paint() {
      var el = self.sh.querySelector('[data-resend]');
      if (!el) { clearInterval(self.resendTimer); return; }
      el.innerHTML = left > 0 ? 'Didn\'t get it? You can ask again in ' + left + 's.' : 'Didn\'t get it? <button type="button" class="lk" data-act="resend">Send a new code</button>';
    }
    paint();
    this.resendTimer = setInterval(function () { left -= 1; paint(); if (left <= 0) clearInterval(self.resendTimer); }, 1000);
  };

  Sheet.prototype.viewAddress = function () {
    var a = this.addr;
    var stateOptions = '<option value="">Select state</option>' + STATES.map(function (s) {
      return '<option' + (a.state === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    var phoneBlock = this.otpFlow()
      ? '<div class="n ok">Phone verified \u00b7 +91 ' + esc(this.phone) + ' <button type="button" class="lk" data-go="phone" style="margin-left:6px">Change</button></div>'
      : '<div class="f"><label for="cod-phone2">Mobile number</label><div class="pre"><span>+91</span><input id="cod-phone2" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="' + esc(this.phone) + '"></div></div>';
    this.frame('Delivery address', this.otpFlow() ? 'phone' : null, 3,
      phoneBlock +
      '<div class="f"><label for="cod-name">Full name</label><input id="cod-name" name="name" autocomplete="name" value="' + esc(a.name || '') + '" data-autofocus></div>' +
      '<div class="f"><label for="cod-a1">House no., building, street, area</label><input id="cod-a1" name="address1" autocomplete="address-line1" value="' + esc(a.address1 || '') + '"></div>' +
      '<div class="f"><label for="cod-a2">Landmark (optional)</label><input id="cod-a2" name="address2" autocomplete="address-line2" value="' + esc(a.address2 || '') + '"></div>' +
      '<div class="two"><div class="f"><label for="cod-pin">PIN code</label><input id="cod-pin" name="pincode" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="' + esc(a.pincode || '') + '"></div>' +
      '<div class="f"><label for="cod-city">City</label><input id="cod-city" name="city" autocomplete="address-level2" value="' + esc(a.city || '') + '"></div></div>' +
      '<div class="f"><label for="cod-state">State</label><select id="cod-state" name="state" autocomplete="address-level1">' + stateOptions + '</select></div>' +
      '<div class="f"><label for="cod-email">Email (optional, for order updates)</label><input id="cod-email" name="email" type="email" autocomplete="email" value="' + esc(a.email || '') + '"></div>' +
      '<div data-pin></div><div data-err></div>',
      '<button type="submit" class="b p">Continue</button>' + '<span data-alt hidden>' + this.payOnlineButton() + '</span>');
    this.submitAction = 'address';
    if (a.pincode && /^[1-9]\d{5}$/.test(a.pincode)) this.lookupPin(a.pincode, true);
  };

  Sheet.prototype.lookupPin = function (pin, keepFilled) {
    var self = this;
    var note = this.sh.querySelector('[data-pin]');
    if ((this.cfg.blockedPincodes || []).indexOf(pin) !== -1) { this.showPinBlocked(pin); return; }
    if (note) note.innerHTML = '';
    phpGet('pincode', '&pin=' + encodeURIComponent(pin)).then(function (json) {
      if (self.view !== 'address') return;
      var pinInput = self.sh.querySelector('#cod-pin');
      if (!pinInput || pinInput.value !== pin) return;
      self.pin = json.success ? json : null;
      if (json.success && json.blocked) { self.showPinBlocked(pin); return; }
      self.togglePinBlocked(false);
      if (json.success && json.found) {
        var city = self.sh.querySelector('#cod-city');
        var state = self.sh.querySelector('#cod-state');
        if (city && (!keepFilled || !city.value)) city.value = json.city;
        if (state && (!keepFilled || !state.value)) {
          var match = STATES.filter(function (s) { return s.toLowerCase() === String(json.state).toLowerCase(); })[0];
          if (match) state.value = match;
        }
      }
    });
  };

  Sheet.prototype.showPinBlocked = function (pin) {
    var note = this.sh.querySelector('[data-pin]');
    if (note) note.innerHTML = '<div class="n er" role="alert">Cash on Delivery isn\'t available for PIN code ' + esc(pin) + '. You can still pay online.</div>';
    this.togglePinBlocked(true);
  };

  Sheet.prototype.togglePinBlocked = function (blocked) {
    var btn = this.sh.querySelector('button[type="submit"]');
    var alt = this.sh.querySelector('[data-alt]');
    if (btn) btn.disabled = blocked;
    if (alt) alt.hidden = !blocked;
  };

  Sheet.prototype.readAddress = function () {
    var f = this.sh.querySelector('form');
    var get = function (n) { var el = f.querySelector('[name="' + n + '"]'); return el ? String(el.value || '').trim() : ''; };
    return { name: get('name'), address1: get('address1'), address2: get('address2'), pincode: get('pincode'), city: get('city'), state: get('state'), email: get('email'), phone: get('phone') };
  };

  Sheet.prototype.viewReview = function () {
    var self = this;
    this.loading('Getting your total\u2026');
    api('/api/cod/quote', { surface: this.opts.surface, items: this.items, coupon: this.coupon, pincode: this.addr.pincode }).then(function (json) {
      if (self.view !== 'review') return;
      if (!json.success) {
        self.frame('Review your order', 'address', 3, '<div class="n er" role="alert">' + esc(json.error) + '</div>', self.payOnlineButton('Pay online') + '<button type="button" class="b s" data-go="address">Change address</button>');
        return;
      }
      self.quote = json.quote;
      self.renderReview();
    });
  };

  Sheet.prototype.renderReview = function () {
    var q = this.quote, fmt = this.fmt, a = this.addr;
    var lines = q.lines.map(function (li) {
      var price = li.total < li.originalTotal ? '<span class="st">' + fmt(li.originalTotal) + '</span>' + fmt(li.total) : fmt(li.total);
      return '<div class="li">' + (li.image ? '<img src="' + esc(li.image) + '" alt="">' : '<div class="ph"></div>') +
        '<div><div class="nm">' + esc(li.title) + '</div><div class="mu">' + (li.variantTitle ? esc(li.variantTitle) + ' \u00b7 ' : '') + 'Qty ' + li.quantity + '</div></div>' +
        '<div class="num" style="font-weight:600">' + price + '</div></div>';
    }).join('');
    var rows = '<div class="rows">' +
      '<div><span>Items</span><span class="num">' + fmt(q.itemsTotal) + '</span></div>' +
      (q.discounts > 0 ? '<div style="color:#067647"><span>Discounts' + (q.coupon && q.coupon.applied ? ' (' + esc(q.coupon.code) + ')' : '') + '</span><span class="num">\u2212' + fmt(q.discounts) + '</span></div>' : '') +
      '<div><span>Shipping</span><span class="num">' + (q.shipping > 0 ? fmt(q.shipping) : 'Free') + '</span></div>' +
      (q.codFee > 0 ? '<div><span>COD fee</span><span class="num">' + fmt(q.codFee) + '</span></div>' : '') +
      (q.tax > 0 && !q.taxesIncluded ? '<div><span>Taxes</span><span class="num">' + fmt(q.tax) + '</span></div>' : '') +
      '<div class="tot"><span>Pay on delivery</span><span class="num">' + fmt(q.total) + '</span></div>' +
      (q.tax > 0 && q.taxesIncluded ? '<div class="mu"><span>Includes ' + fmt(q.tax) + ' in taxes</span></div>' : '') +
      '</div>';
    var couponNote = q.coupon && !q.coupon.applied
      ? '<div class="n wa">Coupon ' + esc(q.coupon.code) + ' can\'t be used on this order, so it was left off.</div>' : '';
    var nudge = this.cfg.prepaidNudgeText && typeof this.opts.onPayOnline === 'function'
      ? '<div class="n in">' + esc(this.cfg.prepaidNudgeText) + ' <button type="button" class="lk" data-act="online">Pay online</button></div>' : '';
    var ship = '<div class="n in"><b>' + esc(a.name) + '</b><br>' + esc(a.address1) + (a.address2 ? ', ' + esc(a.address2) : '') + '<br>' +
      esc(a.city) + ', ' + esc(a.state) + ' ' + esc(a.pincode) + '<br>+91 ' + esc(this.phone) +
      ' <button type="button" class="lk" data-go="address" style="margin-left:6px">Edit</button></div>';
    this.frame('Review your order', 'address', 3, lines + rows + couponNote + ship + nudge + '<div data-err></div>',
      '<button type="submit" class="b p">Place COD order \u00b7 ' + fmt(q.total) + '</button>');
    this.submitAction = 'place';
  };

  Sheet.prototype.viewDone = function (order) {
    var fmt = this.fmt;
    this.sh.innerHTML = '<div class="hd"><div class="t">Order placed</div><button type="button" class="ib" data-act="close" aria-label="Close">&#10005;</button></div>' +
      '<div class="bd done"><div class="tick" aria-hidden="true">&#10003;</div>' +
      '<div style="font-weight:700">Order ' + esc(order.orderName) + ' confirmed</div>' +
      '<div class="big">' + fmt(order.total) + '</div>' +
      '<p style="margin:0">Keep this amount ready when your order is delivered.</p>' +
      (order.statusPageUrl ? '<a href="' + esc(order.statusPageUrl) + '" class="lk" style="display:inline-block">View order status</a>' : '') +
      '</div><div class="ft"><button type="button" class="b p" data-act="close">Continue shopping</button></div>';
  };

  /* --- events --- */

  Sheet.prototype.onClick = function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t || this.busy) return;
    var go = t.getAttribute('data-go');
    var act = t.getAttribute('data-act');
    if (go) { e.preventDefault(); if (this.view === 'address') this.addr = Object.assign(this.addr, this.readAddress()); this.go(go); return; }
    if (act === 'close') { this.close(); return; }
    if (act === 'online') {
      var cb = this.opts.onPayOnline;
      this.close();
      if (typeof cb === 'function') { try { cb(); } catch (err) { /* caller */ } }
      return;
    }
    if (act === 'resend') { this.sendCode(true); return; }
  };

  Sheet.prototype.onInput = function (e) {
    var el = e.target;
    if (el.name === 'pincode') {
      el.value = el.value.replace(/\D/g, '').slice(0, 6);
      if (el.value.length === 6) this.lookupPin(el.value, false);
      else { var note = this.sh.querySelector('[data-pin]'); if (note) note.innerHTML = ''; this.togglePinBlocked(false); }
    }
    if (el.name === 'code') {
      el.value = el.value.replace(/\D/g, '').slice(0, 4);
      if (el.value.length === 4 && !this.busy) this.verifyCode(el.value);
    }
  };

  Sheet.prototype.onSubmit = function () {
    if (this.busy) return;
    if (this.submitAction === 'send') return this.sendCode(false);
    if (this.submitAction === 'verify') {
      var code = this.sh.querySelector('[name="code"]');
      return this.verifyCode(code ? code.value : '');
    }
    if (this.submitAction === 'address') return this.submitAddress();
    if (this.submitAction === 'place') return this.placeOrder();
  };

  Sheet.prototype.sendCode = function (isResend) {
    var self = this;
    if (!isResend) {
      var input = this.sh.querySelector('[name="phone"]');
      var phone = normalizePhone(input && input.value);
      if (!phone) { this.setError('Enter a valid 10-digit mobile number.'); return; }
      this.phone = phone;
    }
    this.setError('');
    this.setBusy(true, 'Sending\u2026');
    api('/api/cod/otp', { step: 'send', phone: this.phone }).then(function (json) {
      self.setBusy(false);
      if (!json.success) {
        if (isResend) { self.setError(json.error); self.startResendTimer(); } else self.setError(json.error);
        return;
      }
      self.resendAfter = json.resendAfter || 30;
      if (isResend) { self.setError(''); self.startResendTimer(); } else self.go('otp');
    });
  };

  Sheet.prototype.verifyCode = function (code) {
    var self = this;
    if (!/^\d{4}$/.test(code || '')) { this.setError('Enter the 4-digit code from the SMS.'); return; }
    this.setError('');
    this.setBusy(true, 'Checking\u2026');
    api('/api/cod/otp', { step: 'verify', phone: this.phone, code: code }).then(function (json) {
      self.setBusy(false);
      if (!json.success) { self.setError(json.error); var el = self.sh.querySelector('[name="code"]'); if (el) { el.value = ''; try { el.focus(); } catch (e) { /* ignore */ } } return; }
      self.token = { shop: SHOP, phone: self.phone, token: json.token, expiresAt: Date.now() + 25 * 60000 };
      writeStore('sessionStorage', TOKEN_KEY, self.token);
      clearInterval(self.resendTimer);
      self.go('address');
    });
  };

  Sheet.prototype.submitAddress = function () {
    var a = this.readAddress();
    if (!this.otpFlow()) {
      var phone = normalizePhone(a.phone);
      if (!phone) { this.setError('Enter a valid 10-digit mobile number.'); return; }
      this.phone = phone;
    }
    var err = null;
    if (a.name.length < 2) err = 'Enter your full name.';
    else if (a.address1.length < 5) err = 'Enter your house number, street and area.';
    else if (!/^[1-9]\d{5}$/.test(a.pincode)) err = 'Enter a valid 6-digit PIN code.';
    else if (a.city.length < 2) err = 'Enter your city.';
    else if (!a.state) err = 'Choose your state.';
    else if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) err = 'Enter a valid email address, or leave it empty.';
    else if ((this.cfg.blockedPincodes || []).indexOf(a.pincode) !== -1 || (this.pin && this.pin.pincode === a.pincode && this.pin.blocked)) err = 'Cash on Delivery isn\'t available for PIN code ' + a.pincode + '.';
    if (err) { this.setError(err); return; }
    delete a.phone;
    this.addr = a;
    writeStore('localStorage', ADDRESS_KEY, Object.assign({}, a, { phone: this.phone }));
    this.go('review');
  };

  Sheet.prototype.placeOrder = function () {
    var self = this;
    this.setError('');
    this.setBusy(true, 'Placing your order\u2026');
    api('/api/cod/order', {
      surface: this.opts.surface,
      items: this.items,
      coupon: this.quote && this.quote.coupon && this.quote.coupon.applied ? this.quote.coupon.code : null,
      attributes: this.opts.attributes || null,
      idemKey: this.idem,
      phone: this.phone,
      token: this.otpFlow() && this.token ? this.token.token : null,
      address: this.addr,
    }).then(function (json) {
      self.setBusy(false);
      if (!json.success) {
        if (json.code === 'otp_required') { writeStore('sessionStorage', TOKEN_KEY, null); self.token = null; self.go('phone'); self.setError(json.error); return; }
        if (json.code !== 'in_progress') self.idem = idemKey();
        self.setError(json.error);
        return;
      }
      self.placed = json.order;
      self.viewDone(json.order);
      var after = self.opts.useCart
        ? window.fetch(ROOT + 'cart/clear.js', { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' }).catch(function () { return null; })
        : Promise.resolve();
      after.then(function () {
        try { document.dispatchEvent(new CustomEvent('brix:cod:order', { detail: json.order })); } catch (e) { /* old browsers */ }
        if (typeof self.opts.onSuccess === 'function') { try { self.opts.onSuccess(json.order); } catch (e) { /* caller UI only */ } }
      });
    });
  };

  /* ---------- public: open ---------- */

  // opts: { surface: 'drawer'|'product'|'combo', items?, useCart?, coupon?, attributes?,
  //         onPayOnline?, onSuccess?, onClosedAfterOrder? }
  function open(opts) {
    opts = opts || {};
    if (sheet) return;
    loadConfig().then(function (cfg) {
      if (!cfg || cfg.surfaces[opts.surface] === false) {
        if (typeof opts.onPayOnline === 'function') opts.onPayOnline();
        return;
      }
      var itemsPromise = opts.useCart
        ? fetchCart().then(function (cart) {
          if (cartHasCheckoutOnlyLines(cart)) return { checkoutOnly: true };
          return { items: cartItems(cart) };
        })
        : Promise.resolve({ items: opts.items || [] });
      sheet = new Sheet(opts, cfg);
      sheet.loading('Checking Cash on Delivery\u2026');
      itemsPromise.then(function (res) {
        if (!sheet) return;
        if (res.checkoutOnly) { sheet.fail('This cart has a Pack or free gift that is only available with online payment.'); return; }
        if (!res.items.length) { sheet.fail('Your cart is empty.'); return; }
        sheet.items = res.items;
        sheet.start();
      }, function () { if (sheet) sheet.fail("We couldn't read your cart. Refresh the page and try again."); });
    });
  }

  /* ---------- cart drawer button ---------- */

  function buttonHtml(cfg, label, sub, disabled) {
    return '<button type="button" data-brix-cod-btn' + (disabled ? ' disabled' : '') +
      ' style="width:100%;padding:14px 16px;margin:0 0 10px 0;background:' + esc(cfg.buttons.bg) + ';color:' + esc(cfg.buttons.color) +
      ';border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';opacity:' + (disabled ? '0.5' : '1') +
      ';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-family:inherit;line-height:1.25;">' +
      '<span>' + esc(label) + '</span>' + (sub ? '<span style="font-size:11.5px;font-weight:500;opacity:.85;">' + esc(sub) + '</span>' : '') + '</button>';
  }

  function feeHint(cfg, fmt) {
    return cfg.codFee > 0 ? '+' + fmt(cfg.codFee) + ' COD fee' : '';
  }

  // Renders the COD button into `slot` inside the BRIX cart drawer.
  // opts: { cart, coupon, onPayOnline, onSuccess }
  function mountDrawerButton(slot, opts) {
    if (!slot) return;
    function paint(cfg) {
      if (!slot.isConnected) return;
      if (!cfg || cfg.surfaces.drawer === false || !opts.cart || !(opts.cart.items || []).length) { slot.innerHTML = ''; return; }
      var fmt = moneyFormatter(cfg.currency);
      var subtotal = (opts.cart.items || []).reduce(function (sum, it) {
        var p = it.properties || {};
        return p._brixReward === 'true' ? sum : sum + (Number(it.final_line_price) || 0);
      }, 0) / 100;
      var reason = '';
      if (cartHasCheckoutOnlyLines(opts.cart)) reason = 'Not available with Packs or free gifts';
      else if (cfg.minOrder > 0 && subtotal < cfg.minOrder) reason = 'Available on orders from ' + fmt(cfg.minOrder);
      else if (cfg.maxOrder > 0 && subtotal > cfg.maxOrder) reason = 'Available on orders up to ' + fmt(cfg.maxOrder);
      slot.innerHTML = buttonHtml(cfg, cfg.buttons.drawerText, reason || feeHint(cfg, fmt), Boolean(reason));
      var btn = slot.querySelector('[data-brix-cod-btn]');
      if (btn && !reason) {
        btn.addEventListener('click', function () {
          open({ surface: 'drawer', useCart: true, coupon: opts.coupon, onPayOnline: opts.onPayOnline, onSuccess: opts.onSuccess });
        });
      }
    }
    if (configValue !== undefined) paint(configValue);
    else loadConfig().then(paint);
  }

  /* ---------- product page button ---------- */

  function isProductPage() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    if (meta && meta.page && meta.page.pageType) return meta.page.pageType === 'product';
    return /\/products\/[^/?#]+/.test(window.location.pathname);
  }

  function findProductForm() {
    var scope = document.querySelector('main') || document;
    var forms = scope.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (!f.querySelector('[name="id"]')) continue;
      if (f.closest('[data-cart-ninja-drawer], cart-drawer, .quick-add-modal, product-recommendations, .card, .product-card, .grid__item')) continue;
      return f;
    }
    return null;
  }

  function submitButtonFor(form) {
    return form.querySelector('[type="submit"][name="add"], button[name="add"], [type="submit"]')
      || (form.id ? document.querySelector('[type="submit"][form="' + form.id + '"]') : null);
  }

  function formSelection(form) {
    var idEl = form.querySelector('[name="id"]');
    var qtyEl = form.querySelector('[name="quantity"]') || (form.id ? document.querySelector('[name="quantity"][form="' + form.id + '"]') : null);
    var properties = {};
    try {
      var fd = new FormData(form);
      fd.forEach(function (value, key) {
        var m = /^properties\[(.+)\]$/.exec(key);
        if (m && typeof value === 'string' && value !== '') properties[m[1]] = value;
      });
    } catch (e) { /* no FormData */ }
    return {
      variantId: idEl ? String(idEl.value || '') : '',
      quantity: Math.max(1, parseInt(qtyEl && qtyEl.value, 10) || 1),
      properties: properties,
    };
  }

  function productTags() {
    var m = /\/products\/([^/?#]+)/.exec(window.location.pathname);
    if (!m) return Promise.resolve([]);
    return window.fetch(ROOT + 'products/' + m[1] + '.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (p) { return Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(','); })
      .catch(function () { return []; });
  }

  function initProductButton() {
    if (!isProductPage()) return;
    loadConfig().then(function (cfg) {
      if (!cfg || cfg.surfaces.product === false) return;
      var form = findProductForm();
      var slot = document.querySelector('[data-brix-cod-slot]');
      if (!form) return;
      productTags().then(function (tags) {
        var excluded = (cfg.excludedProductTags || []).map(function (t) { return String(t).toLowerCase(); });
        if (excluded.length && tags.some(function (t) { return excluded.indexOf(String(t).trim().toLowerCase()) !== -1; })) return;
        var addBtn = submitButtonFor(form);
        if (!slot) {
          slot = document.createElement('div');
          slot.setAttribute('data-brix-cod-slot', 'auto');
          slot.style.cssText = 'margin-top:10px;width:100%;';
          var anchor = addBtn && addBtn.parentNode && form.contains(addBtn) ? addBtn : null;
          if (anchor) anchor.parentNode.insertBefore(slot, anchor.nextSibling);
          else form.appendChild(slot);
        }
        var fmt = moneyFormatter(cfg.currency);
        slot.innerHTML = buttonHtml(cfg, cfg.buttons.productText, feeHint(cfg, fmt), false);
        var btn = slot.querySelector('[data-brix-cod-btn]');
        btn.style.margin = '0';
        function syncDisabled() {
          var soldOut = Boolean(addBtn && (addBtn.disabled || addBtn.getAttribute('aria-disabled') === 'true'));
          btn.disabled = soldOut;
          btn.style.opacity = soldOut ? '0.5' : '1';
          btn.style.cursor = soldOut ? 'not-allowed' : 'pointer';
        }
        syncDisabled();
        if (addBtn && window.MutationObserver) {
          new MutationObserver(syncDisabled).observe(addBtn, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
        }
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var sel = formSelection(form);
          if (!/^\d+$/.test(sel.variantId)) return;
          open({
            surface: 'product',
            items: [sel],
            onPayOnline: function () {
              window.location.href = ROOT + 'cart/' + sel.variantId + ':' + sel.quantity;
            },
          });
        });
      });
    });
  }

  window.BrixCod = {
    open: open,
    isAvailable: isAvailable,
    config: loadConfig,
    mountDrawerButton: mountDrawerButton,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initProductButton);
  else initProductButton();
})();
