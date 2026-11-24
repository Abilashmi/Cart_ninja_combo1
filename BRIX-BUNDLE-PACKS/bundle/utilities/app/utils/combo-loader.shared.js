/**
 * Combo pages: the preloader shown while a combo page loads (all combo
 * templates). One copy of its settings, HTML and CSS:
 *   - the storefront script (combo-page[.]js.jsx) injects this source text
 *     and shows it the moment the page starts loading;
 *   - the builder (components/customization/LoaderSection.jsx) previews it;
 *   - api.combo-loader.jsx sends the settings early (no products), so the
 *     merchant's own look replaces the default round spinner quickly.
 *
 * createComboLoader() has no imports and uses only ES5 syntax, like the
 * pricing core and the box kit, because its source is injected as text.
 *
 * Settings are flat loader_* keys on the combo config; a missing key is the
 * default (a plain round spinner on white).
 */
export function createComboLoader() {
  var DEFAULTS = {
    loader_enabled: true,
    loader_style: 'ring', // ring | dots | pulse
    loader_color: '#111827',
    loader_track: '#e5e7eb',
    loader_bg: '#ffffff',
    loader_size: 44, // px, the ring / dots
    loader_logo: '', // https link or a small raster data URL
    loader_logo_size: 64, // px
    loader_logo_place: 'inside', // inside (the ring goes round it) | above
    loader_text: '',
    loader_text_color: '#6b7280',
    loader_height: 60, // vh the loader area takes
  };
  var STYLES = ['ring', 'dots', 'pulse'];
  var LOGO_MAX_CHARS = 40000;
  var HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  var LOGO_URL_RE = /^https:\/\/[^\s"'<>()\\]{1,500}$/;
  var LOGO_DATA_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

  function has(config, key) {
    return config && Object.prototype.hasOwnProperty.call(config, key) && config[key] !== null && config[key] !== undefined;
  }
  function color(config, key) {
    var v = has(config, key) ? String(config[key]).trim() : '';
    return HEX_RE.test(v) ? v : DEFAULTS[key];
  }
  function num(config, key, min, max) {
    var n = has(config, key) ? Number(config[key]) : NaN;
    if (!isFinite(n)) n = DEFAULTS[key];
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  /** A logo the page may show: an https link or a small raster data URL (never SVG). */
  function isValidLogo(value) {
    if (typeof value !== 'string' || !value) return false;
    if (value.indexOf('data:') === 0) return value.length <= LOGO_MAX_CHARS && LOGO_DATA_RE.test(value);
    return LOGO_URL_RE.test(value);
  }

  /** The loader settings of a combo config, checked and with defaults filled in. */
  function pick(config) {
    var c = config || {};
    var style = has(c, 'loader_style') && STYLES.indexOf(c.loader_style) !== -1 ? c.loader_style : DEFAULTS.loader_style;
    var logo = has(c, 'loader_logo') && isValidLogo(c.loader_logo) ? c.loader_logo : '';
    var text = has(c, 'loader_text') ? String(c.loader_text).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    return {
      enabled: !(has(c, 'loader_enabled') && c.loader_enabled === false),
      style: style,
      color: color(c, 'loader_color'),
      track: color(c, 'loader_track'),
      bg: color(c, 'loader_bg'),
      size: num(c, 'loader_size', 20, 120),
      logo: logo,
      logoSize: num(c, 'loader_logo_size', 24, 200),
      logoPlace: c.loader_logo_place === 'above' ? 'above' : 'inside',
      text: text,
      textColor: color(c, 'loader_text_color'),
      height: num(c, 'loader_height', 20, 100),
    };
  }

  /** Only the loader_* keys of a config (what the storefront caches and the loader endpoint sends). */
  function subset(config) {
    var out = {};
    for (var key in DEFAULTS) if (has(config, key)) out[key] = config[key];
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * The loader's HTML. opts.inline = true draws it in a box of its own height
   * (the builder's preview) instead of taking loader_height of the screen.
   */
  function html(s, opts) {
    var o = opts || {};
    var logo = s.logo ? '<img class="bxl-logo" src="' + esc(s.logo) + '" alt="" />' : '';
    var inside = logo && s.logoPlace === 'inside';
    var ringSize = inside ? Math.max(s.size, s.logoSize + 28) : s.size;
    var vars = '--bxl-color:' + s.color + ';--bxl-track:' + s.track + ';--bxl-bg:' + s.bg + ';--bxl-size:' + ringSize + 'px;--bxl-dot:' + Math.max(6, Math.round(s.size / 4)) + 'px;'
      + '--bxl-logo:' + s.logoSize + 'px;--bxl-text:' + s.textColor + ';' + (o.inline ? 'min-height:' + (o.minHeight || 220) + 'px;' : 'min-height:' + s.height + 'vh;');
    var out = '<div class="bxl bxl--' + s.style + '" role="status" aria-live="polite" aria-label="' + esc(s.text || 'Loading') + '" style="' + vars + '">';
    if (logo && !inside) out += '<div class="bxl-above">' + logo + '</div>';
    if (s.style === 'dots') {
      out += '<div class="bxl-dots">' + (inside ? '<div class="bxl-inside">' + logo + '</div>' : '') + '<span></span><span></span><span></span></div>';
    } else if (s.style === 'pulse') {
      out += '<div class="bxl-pulse">' + (inside ? logo : '<span class="bxl-blob"></span>') + '</div>';
    } else {
      out += '<div class="bxl-ring-wrap"><span class="bxl-ring"></span>' + (inside ? '<div class="bxl-inside">' + logo + '</div>' : '') + '</div>';
    }
    if (s.text) out += '<div class="bxl-text">' + esc(s.text) + '</div>';
    out += '</div>';
    return out;
  }

  var CSS = ''
    + '.bxl{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;width:100%;box-sizing:border-box;padding:32px 16px;background:var(--bxl-bg);}'
    + '.bxl *{box-sizing:border-box;}'
    + '.bxl-logo{display:block;max-width:var(--bxl-logo);max-height:var(--bxl-logo);width:auto;height:auto;object-fit:contain;}'
    + '.bxl-above .bxl-logo{max-width:calc(var(--bxl-logo) * 2.5);}'
    + '.bxl-ring-wrap{position:relative;width:var(--bxl-size);height:var(--bxl-size);}'
    + '.bxl-ring{position:absolute;inset:0;border-radius:50%;border:max(3px,calc(var(--bxl-size) / 12)) solid var(--bxl-track);border-top-color:var(--bxl-color);animation:bxl-spin .8s linear infinite;}'
    + '.bxl-inside{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}'
    + '.bxl-dots{display:flex;align-items:center;gap:calc(var(--bxl-dot) * .8);flex-wrap:wrap;justify-content:center;}'
    + '.bxl-dots .bxl-inside{position:static;flex-basis:100%;margin-bottom:8px;}'
    + '.bxl-dots span{width:var(--bxl-dot);height:var(--bxl-dot);border-radius:50%;background:var(--bxl-color);animation:bxl-bounce 1s ease-in-out infinite;}'
    + '.bxl-dots span:nth-of-type(2){animation-delay:.15s;}'
    + '.bxl-dots span:nth-of-type(3){animation-delay:.3s;}'
    + '.bxl-pulse{display:flex;align-items:center;justify-content:center;animation:bxl-pulse 1.2s ease-in-out infinite;}'
    + '.bxl-blob{display:block;width:var(--bxl-size);height:var(--bxl-size);border-radius:50%;background:var(--bxl-color);}'
    + '.bxl-text{font-size:14px;line-height:1.4;color:var(--bxl-text);text-align:center;max-width:320px;}'
    + '@keyframes bxl-spin{to{transform:rotate(360deg);}}'
    + '@keyframes bxl-bounce{0%,80%,100%{transform:scale(.55);opacity:.45;}40%{transform:scale(1);opacity:1;}}'
    + '@keyframes bxl-pulse{0%,100%{transform:scale(.9);opacity:.6;}50%{transform:scale(1);opacity:1;}}'
    + '@media (prefers-reduced-motion: reduce){.bxl-ring{animation-duration:2.4s;}.bxl-dots span,.bxl-pulse{animation:none;}}';

  return { DEFAULTS: DEFAULTS, STYLES: STYLES, LOGO_MAX_CHARS: LOGO_MAX_CHARS, isValidLogo: isValidLogo, pick: pick, subset: subset, html: html, CSS: CSS };
}
